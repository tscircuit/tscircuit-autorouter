import type { SolverRuntimeExecutor } from "@tscircuit/solver-utils"
import { HighDensityForceImproveSolver } from "high-density-repair01/lib/HighDensityForceImproveSolver"
import {
  Pipeline9HighDensityForceImproveBatchSolver,
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
      const samples = this.sampleEntries
        .slice(this.activeSampleIndex, this.activeSampleIndex + parallelSampleCount)
        .map((entry, index) => ({
          index,
          work: entry.routeIndexes.reduce((sum, routeIndex) =>
            sum + this.originalHdRoutes[routeIndex]!.route.length, 0),
          input: {
            nodeWithPortPoints: [entry.node],
            hdRoutes: entry.routeIndexes.map((routeIndex) => this.originalHdRoutes[routeIndex]!),
            totalStepsPerNode: this.totalStepsPerNode,
            nodeAssignmentMargin: this.nodeAssignmentMargin,
            colorMap: Object.fromEntries(entry.routeIndexes.map((routeIndex) => {
              const name = this.originalHdRoutes[routeIndex]!.connectionName
              return [name, this.colorMap[name]]
            })),
          },
        }))
        .sort((left, right) => right.work - left.work)
      const cursor = new Int32Array(new SharedArrayBuffer(4))
      const results = await Promise.all(
        Array.from({ length: Math.min(4, samples.length) }, () =>
          runtime.executeAsync(Pipeline9HighDensityForceImproveBatchSolver, {
            samples: samples.map((sample) => sample.input),
            cursor,
          }),
        ),
      )
      const pending: Array<Pipeline9HighDensityForceImproveSampleOutput | undefined> =
        Array(samples.length).fill(undefined)
      for (const batch of results) {
        for (const output of batch) {
          const sample = samples[output.index]
          if (!sample || pending[sample.index])
            throw new Error("Force-improve batch returned an invalid or duplicate node")
          pending[sample.index] = output.result
        }
      }
      if (pending.some((output) => output === undefined))
        throw new Error("Force-improve batches did not complete every node")
      for (const promise of pending) {
        if (
          this.solved ||
          this.failed ||
          this.iterations >= Math.min(this.MAX_ITERATIONS, stopAtIteration)
        ) {
          break
        }
        this.completedSample = promise!
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
