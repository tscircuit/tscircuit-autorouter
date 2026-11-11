import { createFixedObstacleViolationEvaluator } from "@tscircuit/repair04"
import type { SolverRuntimeExecutor } from "@tscircuit/solver-utils"
import { HighDensityForceImproveSolver } from "high-density-repair01/lib/HighDensityForceImproveSolver"
import type { SimpleRouteJson } from "lib/types"
import { convertToCircuitJson } from "lib/utils/convertToCircuitJson"
import { RELAXED_DRC_OPTIONS } from "lib/utils/drcPresets"
import { getViaToPadClearance } from "lib/utils/getViaToPadClearance"
import {
  Pipeline9HighDensityForceImproveSampleSolver,
  type Pipeline9HighDensityForceImproveSampleOutput,
} from "./Pipeline9HighDensityForceImproveSampleSolver"
import { getFixedCopperObstacleIndexes } from "./getFixedCopperObstacleIndexes"

type ForceImproveParams = ConstructorParameters<
  typeof HighDensityForceImproveSolver
>[0] & { inputSrj: SimpleRouteJson }
type ForceImproveConstructorParams = ReturnType<
  HighDensityForceImproveSolver["getConstructorParams"]
>[0] & { inputSrj: SimpleRouteJson }
type ViaClearanceViolationKey = string

export class Pipeline9HighDensityForceImproveSolver extends HighDensityForceImproveSolver {
  private asyncRunning = false
  private completedSample?: Pipeline9HighDensityForceImproveSampleOutput
  private readonly inputSrj: SimpleRouteJson
  private readonly fixedCopperObstacleIndexes: ReadonlySet<number>
  private readonly evaluateFixedObstacles: ReturnType<
    typeof createFixedObstacleViolationEvaluator
  >

  constructor(params: ForceImproveParams) {
    super(params)
    this.inputSrj = params.inputSrj
    const representedPadObstacleIndexes = new Set<number>()
    convertToCircuitJson(params.inputSrj, [], {
      originalSrj: params.inputSrj,
      representedPadObstacleIndexes,
    })
    this.fixedCopperObstacleIndexes = getFixedCopperObstacleIndexes({
      inputSrj: params.inputSrj,
      representedPadObstacleIndexes,
    })
    this.evaluateFixedObstacles = createFixedObstacleViolationEvaluator({
      srj: {
        ...params.inputSrj,
        traces: undefined,
        // The checker represents circular copper as an equal-width oval.
        obstacles: params.inputSrj.obstacles.map((obstacle) =>
          obstacle.shape === "circle"
            ? { ...obstacle, type: "oval" as const, height: obstacle.width }
            : obstacle,
        ),
      },
      routes: params.hdRoutes,
      traceClearance:
        params.inputSrj.minTraceToPadEdgeClearance ??
        params.inputSrj.defaultObstacleMargin ??
        RELAXED_DRC_OPTIONS.traceClearance,
      viaClearance:
        getViaToPadClearance(params.inputSrj) ??
        RELAXED_DRC_OPTIONS.traceClearance,
    })
  }

  override getConstructorParams(): readonly [ForceImproveConstructorParams] {
    return [
      {
        ...super.getConstructorParams()[0],
        inputSrj: this.inputSrj,
      },
    ]
  }

  private validateImprovedSample(routeIndexes: number[]): void {
    if (this.fixedCopperObstacleIndexes.size === 0) return
    const originalRoutes = routeIndexes.map(
      (routeIndex) => this.originalHdRoutes[routeIndex],
    )
    const candidateRoutes = routeIndexes.map((routeIndex) => {
      const route = this.improvedRoutesByIndex.get(routeIndex)
      if (!route) throw new Error("Force improvement lost a node's candidate")
      return route
    })
    // Existing via conflicts belong to repair; preserve previously clear pairs.
    const originalViolationKeys = new Set<ViaClearanceViolationKey>(
      this.evaluateFixedObstacles(originalRoutes)
        .filter(
          (violation) =>
            violation.kind === "via" &&
            this.fixedCopperObstacleIndexes.has(violation.obstacleIndex),
        )
        .map((violation) => violation.key),
    )
    const introducesViaClearanceViolation = this.evaluateFixedObstacles(
      candidateRoutes,
    ).some(
      (violation) =>
        violation.kind === "via" &&
        this.fixedCopperObstacleIndexes.has(violation.obstacleIndex) &&
        !originalViolationKeys.has(violation.key),
    )
    if (!introducesViaClearanceViolation) return
    // A node's routes move together; accepting only some can introduce peer shorts.
    for (const routeIndex of routeIndexes) {
      this.improvedRoutesByIndex.delete(routeIndex)
    }
    this.stats.improvedRouteCount = this.improvedRoutesByIndex.size
  }

  async solveAsync(
    runtime?: SolverRuntimeExecutor,
    stopAtIteration = Infinity,
  ): Promise<void> {
    if (this.asyncRunning)
      throw new Error(
        "High-density force improvement solveAsync is already running",
      )
    if (this.solved || this.failed || this.iterations >= stopAtIteration) return
    const startTime = performance.now()
    this.asyncRunning = true
    try {
      if (runtime === undefined) {
        this.solveUntilIteration(stopAtIteration)
        return
      }
      // A node consumes one native step; leave the exhaustion step to the host.
      const parallelSampleCount = Math.max(
        0,
        Math.floor(
          Math.min(this.MAX_ITERATIONS, stopAtIteration) - this.iterations,
        ),
      )
      const pending = this.sampleEntries
        .slice(
          this.activeSampleIndex,
          this.activeSampleIndex + parallelSampleCount,
        )
        .map((entry) =>
          runtime
            .executeAsync(Pipeline9HighDensityForceImproveSampleSolver, {
              nodeWithPortPoints: [entry.node],
              hdRoutes: entry.routeIndexes.map(
                (routeIndex) => this.originalHdRoutes[routeIndex],
              ),
              totalStepsPerNode: this.totalStepsPerNode,
              nodeAssignmentMargin: this.nodeAssignmentMargin,
              preserveTopologyPortAnchors: this.preserveTopologyPortAnchors,
              colorMap: Object.fromEntries(
                entry.routeIndexes.map((routeIndex) => {
                  const name = this.originalHdRoutes[routeIndex].connectionName
                  return [name, this.colorMap[name]]
                }),
              ),
            })
            .then(
              (result) => ({ type: "result" as const, result }),
              (error: unknown) => ({ type: "error" as const, error }),
            ),
        )
      for (const promise of pending) {
        if (
          this.solved ||
          this.failed ||
          this.iterations >= Math.min(this.MAX_ITERATIONS, stopAtIteration)
        ) {
          break
        }
        const outcome = await promise
        if (outcome.type === "error") throw outcome.error
        this.completedSample = outcome.result
        this.step()
      }
      this.solveUntilIteration(stopAtIteration)
    } catch (error) {
      this.failed = true
      this.error = `High-density force improvement runtime error: ${error}`
      throw error
    } finally {
      this.completedSample = undefined
      this.asyncRunning = false
      this.timeToSolve = performance.now() - startTime
    }
  }

  private solveUntilIteration(stopAtIteration: number): void {
    while (!this.solved && !this.failed && this.iterations < stopAtIteration) {
      this.step()
    }
  }

  override _step(): void {
    const result = this.completedSample
    if (!result) {
      const entry = this.sampleEntries[this.activeSampleIndex]
      super._step()
      if (entry) this.validateImprovedSample(entry.routeIndexes)
      return
    }
    this.completedSample = undefined
    const entry = this.sampleEntries[this.activeSampleIndex]
    if (!entry || result.routes.length !== entry.routeIndexes.length) {
      throw new Error("Force-improve result does not match the current node")
    }
    for (const [index, routeIndex] of entry.routeIndexes.entries()) {
      this.improvedRoutesByIndex.set(routeIndex, result.routes[index])
    }
    this.validateImprovedSample(entry.routeIndexes)
    this.latestVisualization = result.latestVisualization
    this.activeSampleIndex += 1
    this.stats = {
      nodeAssignmentMargin: this.nodeAssignmentMargin,
      sampleCount: this.sampleEntries.length,
      improvedNodeCount: this.activeSampleIndex,
      improvedRouteCount: this.improvedRoutesByIndex.size,
      totalStepsPerNode: this.totalStepsPerNode,
    }
    if (this.activeSampleIndex >= this.sampleEntries.length) this.solved = true
  }
}
