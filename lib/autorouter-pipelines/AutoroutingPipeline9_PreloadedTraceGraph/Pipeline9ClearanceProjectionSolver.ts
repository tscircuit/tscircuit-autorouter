import {
  getFixedObstacleViolations,
  getNewViaPadViolations,
  RelaxTraceClearanceSolver,
} from "@tscircuit/repair04"
import type { DrcEvaluator } from "high-density-repair03/lib"
import { BaseSolver } from "lib/solvers/BaseSolver"
import { RELAXED_DRC_OPTIONS } from "lib/testing/drcPresets"
import type { SimpleRouteConnection, SimpleRouteJson } from "lib/types"
import { createElectricalTreeRepairWalks } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/createElectricalTreeRepairWalks"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { createSrjWithBoardValidObstacleLayers } from "lib/utils/create-srj-with-board-valid-obstacle-layers"
import { CLEARANCE_PRECISION_MARGIN } from "./applyPipeline9ClearancePrecisionRepairs"
import { canPublishIndependentClearanceRepairs } from "./canPublishIndependentClearanceRepairs"
import { canonicalizePipeline9HdRoutes } from "./canonicalizePipeline9HdRoutes"
import type { Pipeline9DrcError } from "./pipeline9JointDrcRepairUtils"
import { selectIndependentClearanceRepairs } from "./selectIndependentClearanceRepairs"
import { subdividePipeline9ClearanceSegments } from "./subdividePipeline9ClearanceSegments"

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
  /** Certified physical branches, whose untagged junctions move together. */
  sharedTreeConnections?: SimpleRouteConnection[]
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
      decode?: (walks: HighDensityRoute[]) => HighDensityRoute[]
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

  constructor(params: Pipeline9ClearanceProjectionParams) {
    super()
    this.params = params
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
        connections: [...params.originalSrj.connections, ...(params.sharedTreeConnections ?? [])],
        traces: undefined,
      }
      const originalCanonicalRoutes = canonicalizePipeline9HdRoutes(
        params.routes,
      )
      const canonicalRoutes = params.subdivideSegments
        ? subdividePipeline9ClearanceSegments(originalCanonicalRoutes, errors)
        : originalCanonicalRoutes
      const treeWalks = params.sharedTreeConnections
        ? createElectricalTreeRepairWalks({ connections: params.sharedTreeConnections, routes: canonicalRoutes, layerCount: srj.layerCount })
        : undefined
      const relaxationRoutes = treeWalks?.routes ?? canonicalRoutes
      const solver = new RelaxTraceClearanceSolver({
        srj,
        routes: relaxationRoutes,
        bounds: srj.bounds,
        boundaryMargin: 0,
        boardEdgeClearance: params.originalSrj.minBoardEdgeClearance ?? 0,
        lockedPointIndices: treeWalks?.lockedPointIndices ?? relaxationRoutes.map((route) =>
          route.route.map(() => false),
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
          (params.usePrecisionMargin ? CLEARANCE_PRECISION_MARGIN : 0),
      })
      this.MAX_ITERATIONS = solver.MAX_ITERATIONS + 4
      this.activeSubSolver = solver
      this.stats = {
        sharedTreeRelaxationJunctionCount: treeWalks?.junctionCount ?? 0,
        sharedTreeRelaxationPhysicalRouteCount: canonicalRoutes.length,
        sharedTreeRelaxationWalkCount: relaxationRoutes.length,
        sharedTreeRelaxationPhysicalSegmentCount: canonicalRoutes.reduce((sum, route) => sum + route.route.length - 1, 0),
        sharedTreeRelaxationWalkSegmentReferences: relaxationRoutes.reduce((sum, route) => sum + route.route.length - 1, 0),
        sharedTreeRelaxationInputIssueCount: errors.length,
        sharedTreeRelaxationAccepted: 0,
        sharedTreeRelaxationMovedJunctionCount: 0,
      }
      this.state = {
        phase: "relax",
        context: { srj, errors, originalCanonicalRoutes, canonicalRoutes },
        solver,
        decode: treeWalks?.decode,
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
          candidate: state.decode ? state.decode(state.solver.getOutput()) : state.solver.getOutput(),
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
    const movedJunctions = new Set<string>()
    if (canPublish && params.sharedTreeConnections) {
      const before = new Map(canonicalRoutes.map((route) => [route.connectionName, route]))
      const after = new Map(state.candidate.map((route) => [route.connectionName, route]))
      for (const connection of params.sharedTreeConnections) {
        if (!connection.electricalBranch) continue
        for (const endpoint of [0, 1] as const) {
          if (connection.pointsToConnect[endpoint]!.pcb_port_id) continue
          const initialRoute = before.get(connection.name)!, finalRoute = after.get(connection.name)!
          const initial = endpoint === 0 ? initialRoute.route[0]! : initialRoute.route.at(-1)!
          const final = endpoint === 0 ? finalRoute.route[0]! : finalRoute.route.at(-1)!
          if (initial.x !== final.x || initial.y !== final.y) movedJunctions.add(endpoint === 0 ? connection.electricalBranch.startVertexId : connection.electricalBranch.endVertexId)
        }
      }
    }
    this.stats = { ...this.stats, sharedTreeRelaxationAccepted: Number(canPublish), sharedTreeRelaxationProposedIssueCount: candidateErrors.length, sharedTreeRelaxationMovedJunctionCount: movedJunctions.size }
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
