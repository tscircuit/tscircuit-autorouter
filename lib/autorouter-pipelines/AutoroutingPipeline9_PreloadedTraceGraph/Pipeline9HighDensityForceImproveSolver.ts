import { Pipeline9HighDensityForceImproveBatchSolver } from "./Pipeline9HighDensityForceImproveBatchSolver"
import type { SolverRuntimeExecutor } from "@tscircuit/solver-utils"
import { HighDensityForceImproveSolver } from "high-density-repair01/lib/HighDensityForceImproveSolver"
import {
  Pipeline9HighDensityForceImproveSampleSolver,
  type Pipeline9HighDensityForceImproveSampleOutput,
} from "./Pipeline9HighDensityForceImproveSampleSolver"

export class Pipeline9HighDensityForceImproveSolver extends HighDensityForceImproveSolver {
  private asyncRunning = false
  private completedSample?: Pipeline9HighDensityForceImproveSampleOutput

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
      const inputs = this.sampleEntries
        .slice(
          this.activeSampleIndex,
          this.activeSampleIndex + parallelSampleCount,
        )
        .map((entry) => ({
          nodeWithPortPoints: [entry.node],
          hdRoutes: entry.routeIndexes.map(
            (routeIndex) => this.originalHdRoutes[routeIndex],
          ),
          totalStepsPerNode: this.totalStepsPerNode,
          nodeAssignmentMargin: this.nodeAssignmentMargin,
          colorMap: Object.fromEntries(
            entry.routeIndexes.map((routeIndex) => {
              const name = this.originalHdRoutes[routeIndex].connectionName
              return [name, this.colorMap[name]]
            }),
          ),
        }))
      const pending: Array<Promise<
        | { type: "result"; result: Pipeline9HighDensityForceImproveSampleOutput }
        | { type: "error"; error: unknown }
      >> = []
      for (let index = 0; index < inputs.length; index += 8) {
        const batch = inputs.slice(index, index + 8)
        const job = runtime.executeAsync(Pipeline9HighDensityForceImproveBatchSolver, batch).then(
          (results) => ({ type: "results" as const, results }),
          (error: unknown) => ({ type: "error" as const, error }),
        )
        for (let offset = 0; offset < batch.length; offset++) {
          pending.push(job.then((outcome) => outcome.type === "error"
            ? outcome
            : { type: "result" as const, result: outcome.results[offset]! }))
        }
      }
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
      super._step()
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
