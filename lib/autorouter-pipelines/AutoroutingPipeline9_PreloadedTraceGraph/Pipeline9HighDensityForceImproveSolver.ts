import type { SolverRuntimeExecutor } from "@tscircuit/solver-utils"
import { HighDensityForceImproveSolver } from "high-density-repair01/lib/HighDensityForceImproveSolver"
import { areRouteViasAllowed } from "lib/solvers/HighDensitySolver/areRouteViasAllowed"
import type { ViaPlacementValidator } from "lib/types/high-density-types"
import { getPipeline9ViaPlacementValidator, type Pipeline9ViaPlacementContext } from "./getPipeline9ViaPlacementValidator"
import {
  Pipeline9HighDensityForceImproveSampleSolver,
  type Pipeline9HighDensityForceImproveSampleOutput,
} from "./Pipeline9HighDensityForceImproveSampleSolver"

export class Pipeline9HighDensityForceImproveSolver extends HighDensityForceImproveSolver {
  private asyncRunning = false
  private completedSample?: Pipeline9HighDensityForceImproveSampleOutput
  private readonly viaPlacementContext?: Pipeline9ViaPlacementContext
  private readonly viaPlacementValidator?: ViaPlacementValidator
  private rejectedViaPlacementProposals = 0

  constructor(params: ConstructorParameters<typeof HighDensityForceImproveSolver>[0] & {
    viaPlacementContext?: Pipeline9ViaPlacementContext
  }) {
    super(params)
    this.viaPlacementContext = params.viaPlacementContext
    this.viaPlacementValidator = params.viaPlacementContext
      ? getPipeline9ViaPlacementValidator(params.viaPlacementContext) : undefined
    if (this.viaPlacementValidator && !this.originalHdRoutes.every((route) =>
      areRouteViasAllowed(route, this.viaPlacementValidator!, this.viaPlacementContext!.layerCount,
        this.viaPlacementContext!.allowBlindAndBuriedVias),
    )) throw new Error("Force-improve input violates original via-placement constraints")
  }

  override getConstructorParams(): readonly [
    ReturnType<HighDensityForceImproveSolver["getConstructorParams"]>[0] & {
      viaPlacementContext?: Pipeline9ViaPlacementContext
    },
  ] {
    return [{ ...super.getConstructorParams()[0],
      ...(this.viaPlacementContext ? { viaPlacementContext: this.viaPlacementContext } : {}),
    }]
  }

  private acceptViaPlacementProposal(routeIndexes: number[]): void {
    if (!this.viaPlacementValidator || !this.viaPlacementContext) return
    const proposals = routeIndexes.map((index) => {
      const route = this.improvedRoutesByIndex.get(index)
      if (!route || route.connectionName !== this.originalHdRoutes[index]!.connectionName) {
        throw new Error("Force-improve proposal lost its assigned route identity")
      }
      return route
    })
    if (!proposals.every((route) => areRouteViasAllowed(route, this.viaPlacementValidator!,
      this.viaPlacementContext!.layerCount, this.viaPlacementContext!.allowBlindAndBuriedVias))) {
      // Numerical optimization is optional; declining its proposal preserves the validated input.
      for (const index of routeIndexes) this.improvedRoutesByIndex.delete(index)
      this.rejectedViaPlacementProposals++
    }
    this.stats = { ...this.stats, improvedRouteCount: this.improvedRoutesByIndex.size,
      viaPlacementCandidateRejectionCount: this.rejectedViaPlacementProposals }
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
      const previousIndex = this.activeSampleIndex
      super._step()
      if (this.activeSampleIndex === previousIndex + 1) {
        this.acceptViaPlacementProposal(this.sampleEntries[previousIndex]!.routeIndexes)
      }
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
    this.acceptViaPlacementProposal(entry.routeIndexes)
  }
}
