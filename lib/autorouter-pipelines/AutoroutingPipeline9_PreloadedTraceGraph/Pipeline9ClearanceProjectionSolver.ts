import type { SolverRuntimeExecutor } from "@tscircuit/solver-utils"
import {
  getFixedObstacleViolations,
  getNewViaPadViolations,
  RelaxTraceClearanceSolver,
} from "@tscircuit/repair04"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { BaseSolver } from "lib/solvers/BaseSolver"
import { RELAXED_DRC_OPTIONS } from "lib/testing/drcPresets"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { createSrjWithBoardValidObstacleLayers } from "lib/utils/create-srj-with-board-valid-obstacle-layers"
import { Pipeline9ClearanceProjectionWorker } from "./Pipeline9ClearanceProjectionWorker"
import { cropPipeline9ProjectionInput } from "./cropPipeline9ProjectionInput"
import { CLEARANCE_PRECISION_MARGIN } from "./applyPipeline9ClearancePrecisionRepairs"
import { canPublishIndependentClearanceRepairs } from "./canPublishIndependentClearanceRepairs"
import { canonicalizePipeline9HdRoutes } from "./canonicalizePipeline9HdRoutes"
import type { Pipeline9DrcError } from "./pipeline9JointDrcRepairUtils"
import { selectIndependentClearanceRepairs } from "./selectIndependentClearanceRepairs"
import { subdividePipeline9ClearanceSegments } from "./subdividePipeline9ClearanceSegments"

// Finite relaxation sweeps can stop just below the requested via copper gap.
const VIA_COPPER_PROJECTION_MARGIN = 1e-5

export type Pipeline9ClearanceProjectionParams = {
  originalSrj: SimpleRouteJson
  routes: HighDensityRoute[]
  drcEvaluator: DrcEvaluator
  /** Geometry before regional rerouting, matching the outer via guard. */
  previousRoutes?: HighDensityRoute[]
  /** Retain independently safe wire adjustments on boards with mixed errors. */
  allowPartialRepair?: boolean
  /** Add local bend vertices before projecting wire and via clearances. */
  subdivideSegments?: boolean
  /** Keep the same small clearance margin when validating a final coupled pass. */
  usePrecisionMargin?: boolean
  /** Keep preloaded copper fixed during a local clearance repair. */
  lockedConnectionNames?: ReadonlySet<string>
  movableRegions?: { center: { x: number; y: number }; radius: number }[]
}

type ProjectionContext = {
  srj: SimpleRouteJson & { traces: undefined }
  errors: Pipeline9DrcError[]
  originalCanonicalRoutes: HighDensityRoute[]
  canonicalRoutes: HighDensityRoute[]
}

type ProjectionState =
  | { phase: "initialize" }
  | {
      phase: "relax"
      context: ProjectionContext
      solver: RelaxTraceClearanceSolver
    }
  | {
      phase: "select" | "physical-validation" | "reference-validation"
      context: ProjectionContext
      candidate: HighDensityRoute[]
    }
  | { phase: "finished"; output: HighDensityRoute[] }

/** Projects clearance in resumable chunks before publishing guarded geometry. */
export class Pipeline9ClearanceProjectionSolver extends BaseSolver {
  readonly params: Pipeline9ClearanceProjectionParams
  private state: ProjectionState = { phase: "initialize" }
  private asyncRunning = false
  private parallelAttempted = false

  constructor(params: Pipeline9ClearanceProjectionParams) {
    super()
    this.params = params
  }

  /** Try independent spatial partitions and publish only a validated candidate. */
  async solveAsync(
    runtime?: SolverRuntimeExecutor,
    stopAtIteration = Infinity,
  ): Promise<void> {
    if (this.asyncRunning) throw new Error("Clearance projection is already running")
    if (this.solved || this.failed || this.iterations >= stopAtIteration) return
    this.asyncRunning = true
    try {
      if (this.state.phase === "initialize") this.step()
      const state = this.state
      if (
        runtime &&
        !this.parallelAttempted &&
        state.phase === "relax" &&
        state.solver.iterations === 0 &&
        stopAtIteration - this.iterations >= 256
      ) {
        this.parallelAttempted = true
        const input = state.solver.input
        // Identical coordinates share a partition, including shared-net junctions.
        const points = new Map<string, { x: number; y: number; count: number }>()
        for (const [routeIndex, route] of input.routes.entries()) {
          for (const [pointIndex, point] of route.route.entries()) {
            if (input.lockedPointIndices[routeIndex]![pointIndex]) continue
            const key = `${point.x},${point.y}`
            const existing = points.get(key)
            if (existing) existing.count++
            else points.set(key, { x: point.x, y: point.y, count: 1 })
          }
        }
        // Avoid four full-board preparations when the available work is tiny.
        const entries = [...points.entries()].sort(
          ([, a], [, b]) => a.x - b.x || a.y - b.y,
        )
        if (entries.length >= 32) {
          const assignments = new Map<string, number>()
          const total = entries.reduce((sum, [, point]) => sum + point.count, 0)
          let assigned = 0
          for (const [key, point] of entries) {
            assignments.set(key, Math.min(3, Math.floor((assigned * 4) / total)))
            assigned += point.count
          }
          const crops = Array.from({ length: 4 }, (_, partition) =>
            cropPipeline9ProjectionInput(input, assignments, partition),
          )
          const results = await Promise.all(
            crops.map((crop) =>
              runtime.executeAsync(Pipeline9ClearanceProjectionWorker, crop.input),
            ),
          )
          this.stats.parallelProjectionWorkers = results.length
          this.stats.parallelProjectionRouteCounts = crops.map((crop) => crop.routeIndexes.length)
          const childIterations = Math.max(...results.map((result) => result.iterations))
          if (this.iterations + childIterations <= stopAtIteration) {
            const candidate = structuredClone(input.routes)
            for (const [partition, crop] of crops.entries()) {
              for (const [localIndex, routeIndex] of crop.routeIndexes.entries()) {
                const route = input.routes[routeIndex]!
                const projected = results[partition]!.routes[localIndex]!
                for (const [pointIndex, point] of route.route.entries()) {
                  if (assignments.get(`${point.x},${point.y}`) !== partition) continue
                  candidate[routeIndex]!.route[pointIndex]!.x = projected.route[pointIndex]!.x
                  candidate[routeIndex]!.route[pointIndex]!.y = projected.route[pointIndex]!.y
                }
              }
            }
            for (const output of candidate) {
              output.vias = []
              for (let i = 1; i < output.route.length; i++) {
                const a = output.route[i - 1]!
                const b = output.route[i]!
                if (
                  a.z !== b.z &&
                  a.toNextSegmentType !== "through_obstacle" &&
                  !output.vias.some((via) => via.x === b.x && via.y === b.y)
                ) output.vias.push({ x: b.x, y: b.y })
              }
            }
            const savedIterations = this.iterations
            const savedMaximum = this.MAX_ITERATIONS
            const savedProgress = this.progress
            this.iterations += childIterations
            this.MAX_ITERATIONS = Math.max(...results.map((result) => result.maxIterations)) + 4
            this.activeSubSolver = null
            this.state = { phase: "select", context: state.context, candidate }
            while (!this.solved && !this.failed && this.iterations < stopAtIteration) {
              this.step()
            }
            const finalState = this.state as ProjectionState
            if (this.solved && finalState.phase === "finished" && finalState.output !== this.params.routes) {
              this.stats.parallelProjectionAccepted = true
              return
            }
            // A rejected or budget-truncated proposal is not part of the serial
            // solver's logical work; replay from its untouched relaxation child.
            this.stats.parallelProjectionAccepted = false
            this.solved = false
            this.iterations = savedIterations
            this.MAX_ITERATIONS = savedMaximum
            this.progress = savedProgress
            this.state = state
            this.activeSubSolver = state.solver
          }
        }
      }
      while (!this.solved && !this.failed && this.iterations < stopAtIteration) {
        this.step()
      }
    } catch (error) {
      this.failed = true
      this.error = `Clearance projection runtime error: ${error}`
      throw error
    } finally {
      this.asyncRunning = false
    }
  }

  override _step(): void {
    const state = this.state
    const params = this.params
    if (state.phase === "initialize") {
      const reference = params.drcEvaluator({
        traces: [],
        routes: params.routes,
        hdRoutes: params.routes,
      })
      const errors = Array.isArray(reference) ? reference : reference.errors
      if (errors.length === 0) {
        this.state = { phase: "finished", output: params.routes }
        this.solved = true
        return
      }
      const srj = {
        ...createSrjWithBoardValidObstacleLayers(params.originalSrj),
        traces: undefined,
      }
      const originalCanonicalRoutes = canonicalizePipeline9HdRoutes(
        params.routes,
      )
      const canonicalRoutes = params.subdivideSegments
        ? subdividePipeline9ClearanceSegments(originalCanonicalRoutes, errors)
        : originalCanonicalRoutes
      const solver = new RelaxTraceClearanceSolver({
        srj,
        routes: canonicalRoutes,
        bounds: srj.bounds,
        boundaryMargin: 0,
        boardEdgeClearance: params.originalSrj.minBoardEdgeClearance ?? 0,
        lockedPointIndices: canonicalRoutes.map((route) =>
          route.route.map(
            (point) =>
              params.lockedConnectionNames?.has(route.connectionName) ===
                true ||
              (params.movableRegions !== undefined &&
                !params.movableRegions.some(
                  ({ center, radius }) =>
                    Math.hypot(point.x - center.x, point.y - center.y) <=
                    radius,
                )),
          ),
        ),
        allowViaMovement: !params.allowPartialRepair,
        traceClearance:
          (params.originalSrj.minTraceToPadEdgeClearance ??
            RELAXED_DRC_OPTIONS.traceClearance!) +
          (params.allowPartialRepair || params.usePrecisionMargin
            ? CLEARANCE_PRECISION_MARGIN
            : 0),
        viaClearance:
          (params.originalSrj.minPadEdgeToPadEdgeClearance ??
            RELAXED_DRC_OPTIONS.viaClearance!) +
          VIA_COPPER_PROJECTION_MARGIN +
          (params.usePrecisionMargin ? CLEARANCE_PRECISION_MARGIN : 0),
      })
      this.MAX_ITERATIONS = solver.MAX_ITERATIONS + 4
      this.activeSubSolver = solver
      this.state = {
        phase: "relax",
        context: { srj, errors, originalCanonicalRoutes, canonicalRoutes },
        solver,
      }
      return
    }
    if (state.phase === "relax") {
      state.solver.step()
      this.MAX_ITERATIONS = state.solver.MAX_ITERATIONS + 4
      if (state.solver.failed) {
        throw new Error(`Clearance relaxation failed: ${state.solver.error}`)
      }
      if (state.solver.solved) {
        this.activeSubSolver = null
        this.state = {
          phase: "select",
          context: state.context,
          candidate: state.solver.getOutput(),
        }
      }
      return
    }
    if (state.phase === "finished") {
      throw new Error("Clearance projection stepped after completion")
    }
    const { srj, errors, originalCanonicalRoutes, canonicalRoutes } =
      state.context
    if (state.phase === "select") {
      let candidate = state.candidate
      if (params.allowPartialRepair) {
        candidate = selectIndependentClearanceRepairs({
          srj,
          routes: canonicalRoutes,
          proposedRoutes: candidate,
        })
        // Do not retain extra vertices on protected or rejected routes.
        candidate = candidate.map(
          (route, index): HighDensityRoute =>
            route === canonicalRoutes[index]
              ? originalCanonicalRoutes[index]!
              : route,
        )
      }
      this.state = {
        phase: "physical-validation",
        context: state.context,
        candidate,
      }
      return
    }
    if (state.phase === "physical-validation") {
      const fixedViolations = new Map(
        getFixedObstacleViolations({ srj, routes: canonicalRoutes }).map(
          (violation) => [violation.key, violation.severity],
        ),
      )
      if (
        getFixedObstacleViolations({ srj, routes: state.candidate }).some(
          ({ key, severity }) =>
            !fixedViolations.has(key) ||
            severity > fixedViolations.get(key)! + 1e-8,
        ) ||
        getNewViaPadViolations({
          srj,
          previousRoutes: params.previousRoutes ?? canonicalRoutes,
          routes: state.candidate,
        }).length > 0
      ) {
        this.state = { phase: "finished", output: params.routes }
        this.solved = true
        return
      }
      this.state = { ...state, phase: "reference-validation" }
      return
    }
    const candidateReference = params.drcEvaluator({
      traces: [],
      routes: state.candidate,
      hdRoutes: state.candidate,
    })
    const candidateErrors = Array.isArray(candidateReference)
      ? candidateReference
      : candidateReference.errors
    const canPublish = params.allowPartialRepair
      ? canPublishIndependentClearanceRepairs(errors, candidateErrors)
      : candidateErrors.length < errors.length
    this.state = {
      phase: "finished",
      output: canPublish ? state.candidate : params.routes,
    }
    this.solved = true
  }

  getOutput(): HighDensityRoute[] {
    if (!this.solved || this.state.phase !== "finished") {
      throw new Error("Clearance projection is not complete")
    }
    return this.state.output
  }

  computeProgress(): number {
    switch (this.state.phase) {
      case "initialize":
        return 0
      case "relax":
        return 0.9 * this.state.solver.progress
      case "select":
        return 0.9
      case "physical-validation":
        return 0.93
      case "reference-validation":
        return 0.96
      case "finished":
        return 1
    }
  }
}
