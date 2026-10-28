import type { SolverRuntimeExecutor } from "@tscircuit/solver-utils"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { HighDensityForceImproveSolver } from "high-density-repair01/lib/HighDensityForceImproveSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import { arePipeline9NativeRoutesPhysicallyValid } from "./arePipeline9NativeRoutesPhysicallyValid"
import { getPipeline9PhysicalBoardObstaclesInBounds } from "./getPipeline9PhysicalBoardObstaclesInBounds"
import {
  Pipeline9HighDensityForceImproveSampleSolver,
  type Pipeline9HighDensityForceImproveSampleOutput,
} from "./Pipeline9HighDensityForceImproveSampleSolver"

export type Pipeline9ForceImprovePhysicalValidation = Omit<
  Parameters<typeof arePipeline9NativeRoutesPhysicallyValid>[0],
  "routes" | "connMap"
> & { connectivityNetMap: ConnectivityMap["netMap"] }

type RouteBounds = {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export class Pipeline9HighDensityForceImproveSolver extends HighDensityForceImproveSolver {
  private asyncRunning = false
  private completedSample?: Pipeline9HighDensityForceImproveSampleOutput
  private readonly physicalValidation?: Pipeline9ForceImprovePhysicalValidation
  private readonly validationConnectivity?: ConnectivityMap
  private readonly routeBounds: Array<RouteBounds | undefined> = []
  private readonly immutableRouteBounds: Array<RouteBounds | undefined> = []
  private rejectedPhysicalProposals = 0

  constructor(params: ConstructorParameters<typeof HighDensityForceImproveSolver>[0] & {
    physicalValidation?: Pipeline9ForceImprovePhysicalValidation
  }) {
    super(params)
    this.physicalValidation = params.physicalValidation
    if (this.physicalValidation) {
      this.validationConnectivity = new ConnectivityMap(
        this.physicalValidation.connectivityNetMap,
      )
      for (const route of this.originalHdRoutes) {
        this.routeBounds.push(this.getRouteBounds(route))
      }
      for (const route of this.physicalValidation.immutableRoutes ?? []) {
        this.immutableRouteBounds.push(this.getRouteBounds(route))
      }
    }
  }

  override getConstructorParams(): readonly [
    ReturnType<HighDensityForceImproveSolver["getConstructorParams"]>[0] & {
      physicalValidation?: Pipeline9ForceImprovePhysicalValidation
    },
  ] {
    return [{
      ...super.getConstructorParams()[0],
      ...(this.physicalValidation ? { physicalValidation: this.physicalValidation } : {}),
    }]
  }

  private getRouteBounds(route: HighDensityRoute): RouteBounds | undefined {
    const points = [...route.route, ...route.vias]
    if (points.length === 0) return undefined
    if (points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
      throw new Error("Force improvement produced non-finite route geometry")
    }
    const dimensions = this.physicalValidation?.routeDimensionsByConnectionName?.[route.connectionName]
    const radius = Math.max(
      route.traceThickness / 2,
      route.viaDiameter / 2,
      (dimensions?.traceThickness ?? 0) / 2,
      (dimensions?.viaDiameter ?? 0) / 2,
      ((this.physicalValidation?.viaHoleDiameter ?? 0) +
        (this.physicalValidation?.minViaHoleEdgeToViaHoleEdgeClearance ?? 0)) / 2,
      ...route.route.map((point) => (point.traceThickness ?? route.traceThickness) / 2),
    )
    return {
      minX: Math.min(...points.map((point) => point.x)) - radius,
      minY: Math.min(...points.map((point) => point.y)) - radius,
      maxX: Math.max(...points.map((point) => point.x)) + radius,
      maxY: Math.max(...points.map((point) => point.y)) + radius,
    }
  }

  private acceptPhysicalProposal(routeIndexes: number[]): void {
    const context = this.physicalValidation
    if (!context || !this.validationConnectivity) return
    const proposals = routeIndexes.map((index) => {
      const route = this.improvedRoutesByIndex.get(index)
      if (!route || route.connectionName !== this.originalHdRoutes[index]!.connectionName) {
        throw new Error("Force improvement proposal lost its assigned route identity")
      }
      return route
    })
    const proposalBounds = proposals.map((route) => this.getRouteBounds(route))
    const proposedIndexes = new Set(routeIndexes)
    const outsideRoutes: HighDensityRoute[] = []
    const intersectsProposal = (bounds: RouteBounds | undefined): boolean =>
      bounds !== undefined && proposalBounds.some((proposal) => proposal !== undefined &&
        proposal.minX - context.traceClearance <= bounds.maxX &&
        proposal.maxX + context.traceClearance >= bounds.minX &&
        proposal.minY - context.traceClearance <= bounds.maxY &&
        proposal.maxY + context.traceClearance >= bounds.minY)
    for (let index = 0; index < this.immutableRouteBounds.length; index++) {
      if (intersectsProposal(this.immutableRouteBounds[index])) {
        outsideRoutes.push(context.immutableRoutes![index]!)
      }
    }
    for (let index = 0; index < this.originalHdRoutes.length; index++) {
      if (proposedIndexes.has(index)) continue
      const bounds = this.routeBounds[index]
      if (!intersectsProposal(bounds)) continue
      outsideRoutes.push(this.improvedRoutesByIndex.get(index) ?? this.originalHdRoutes[index]!)
    }
    const accepted = arePipeline9NativeRoutesPhysicallyValid({
      ...context,
      boardObstacles: this.getNearbyObstacles(proposalBounds),
      connMap: this.validationConnectivity,
      routes: proposals,
      immutableRoutes: outsideRoutes,
    })
    if (accepted) {
      for (let index = 0; index < routeIndexes.length; index++) {
        this.routeBounds[routeIndexes[index]!] = proposalBounds[index]
      }
    } else {
      // Numerical optimization proposes an optional replacement. A rejected
      // proposal never changes the incoming copper or hides a solver error.
      for (const index of routeIndexes) this.improvedRoutesByIndex.delete(index)
      this.rejectedPhysicalProposals++
    }
    this.stats = {
      ...this.stats,
      improvedRouteCount: this.improvedRoutesByIndex.size,
      physicalCandidateRejectionCount: this.rejectedPhysicalProposals,
    }
  }

  private getNearbyObstacles(bounds: Array<RouteBounds | undefined>): Obstacle[] {
    const context = this.physicalValidation
    if (!context) return []
    const clearance = Math.max(context.traceClearance, context.viaToPadClearance,
      context.traceToPadClearance ?? context.traceClearance,
      context.traceToHoleClearance ?? 0.2)
    const obstacles = new Set<Obstacle>()
    for (const bound of bounds) {
      if (!bound) continue
      for (const obstacle of getPipeline9PhysicalBoardObstaclesInBounds(context.boardObstacles, {
        minX: bound.minX - clearance, minY: bound.minY - clearance,
        maxX: bound.maxX + clearance, maxY: bound.maxY + clearance,
      })) {
        obstacles.add(obstacle)
      }
    }
    return [...obstacles]
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
      const entry = this.sampleEntries[this.activeSampleIndex]
      super._step()
      if (entry) this.acceptPhysicalProposal(entry.routeIndexes)
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
    this.acceptPhysicalProposal(entry.routeIndexes)
    if (this.activeSampleIndex >= this.sampleEntries.length) this.solved = true
  }
}
