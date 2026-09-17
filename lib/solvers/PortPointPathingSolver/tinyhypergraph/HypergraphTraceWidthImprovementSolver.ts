import { BaseSolver } from "lib/solvers/BaseSolver"
import { UniformPortDistributionSolver } from "lib/solvers/UniformPortDistributionSolver/UniformPortDistributionSolver"
import type { Obstacle } from "lib/types"
import { getIntraNodeCrossingsUsingCircle } from "lib/utils/getIntraNodeCrossingsUsingCircle"
import { TinyHyperGraphSolver } from "tiny-hypergraph/lib/index"
import { TinyHypergraphPortPointPathingSolver } from "./TinyHypergraphPortPointPathingSolver"
import { hasPreloadedTraceSectionMetadata } from "./serializePreloadedTraceAssignments"

type WidthImprovementInput = {
  pathingSolver: TinyHypergraphPortPointPathingSolver
  boardMinTraceWidth: number
  clearance: number
  effort: number
  obstacles: Obstacle[]
}

type RouteWidth = {
  routeId: number
  connectionId: string
  requestedWidth: number
}

const MAX_WIDTH_IMPROVEMENT_ATTEMPTS = 8

/** Improves the completed hypergraph assignment without making initial routing harder. */
export class HypergraphTraceWidthImprovementSolver extends BaseSolver {
  private selectedSolver: TinyHyperGraphSolver
  private candidate?: TinyHyperGraphSolver
  private currentRoute?: RouteWidth
  private routeWidths: RouteWidth[]
  private nextRouteIndex = 0
  private improvedRouteCount = 0
  private attemptedRouteCount = 0
  private rejectedCrossingCount = 0
  private improvedConnectionIds = new Set<string>()

  constructor(private input: WidthImprovementInput) {
    super()
    this.selectedSolver = input.pathingSolver.getSolvedTinySolver()
    this.routeWidths = Array.from(
      { length: this.selectedSolver.problem.routeCount },
      (_, routeId): RouteWidth | undefined => {
        const metadata = this.selectedSolver.problem.routeMetadata?.[routeId] as
          | { connectionId: string }
          | undefined
        // These synthetic routes represent existing copper, not requested
        // connections whose width can be improved by this stage.
        if (hasPreloadedTraceSectionMetadata(metadata)) return undefined
        if (!metadata?.connectionId) {
          throw new Error(
            `Missing connection ID for hypergraph route ${routeId}`,
          )
        }
        const connection = input.pathingSolver.getConnectionByIdOrThrow(
          metadata.connectionId,
        )
        const requestedWidth = Math.max(
          input.boardMinTraceWidth,
          connection.minTraceWidth ?? 0,
          connection.nominalTraceWidth ?? 0,
        )
        return requestedWidth > input.boardMinTraceWidth + 1e-6
          ? { routeId, connectionId: metadata.connectionId, requestedWidth }
          : undefined
      },
    )
      .filter((route): route is RouteWidth => route !== undefined)
      .sort(
        (a, b) =>
          b.requestedWidth -
          this.getRouteClearance(this.selectedSolver, b.routeId) -
          (a.requestedWidth -
            this.getRouteClearance(this.selectedSolver, a.routeId)),
      )
      .slice(0, MAX_WIDTH_IMPROVEMENT_ATTEMPTS)
    this.MAX_ITERATIONS = Math.max(
      1,
      this.routeWidths.length *
        (Math.ceil(20_000 * Math.max(0.1, input.effort)) + 2) +
        1,
    )
  }

  private getRouteClearance(
    solver: TinyHyperGraphSolver,
    routeId: number,
  ): number {
    let bottleneck = Number.POSITIVE_INFINITY
    for (
      let regionId = 0;
      regionId < solver.state.regionSegments.length;
      regionId++
    ) {
      if (solver.topology.regionMetadata?.[regionId]?._tinyTerminal) continue
      if (
        !solver.state.regionSegments[regionId].some(([id]) => id === routeId)
      ) {
        continue
      }
      bottleneck = Math.min(
        bottleneck,
        Math.min(
          solver.topology.regionWidth[regionId],
          solver.topology.regionHeight[regionId],
        ) -
          2 * this.input.clearance,
      )
    }
    return bottleneck
  }

  private createCandidate(route: RouteWidth): TinyHyperGraphSolver {
    const { topology, problem, state } = this.selectedSolver
    const initialAssignments = state.regionSegments.flatMap(
      (segments, regionId) =>
        segments
          .filter(([routeId]) => routeId !== route.routeId)
          .map(([routeId, fromPortId, toPortId]) => ({
            routeId,
            regionId,
            fromPortId,
            toPortId,
          })),
    )
    const portPenalty = problem.portPenalty
      ? new Float64Array(problem.portPenalty)
      : new Float64Array(topology.portCount)
    const requiredSpace = route.requestedWidth + 2 * this.input.clearance
    for (let portId = 0; portId < topology.portCount; portId++) {
      if (
        topology.incidentPortRegion[portId].some(
          (regionId) =>
            !topology.regionMetadata?.[regionId]?._tinyTerminal &&
            Math.min(
              topology.regionWidth[regionId],
              topology.regionHeight[regionId],
            ) +
              1e-6 <
              requiredSpace,
        )
      ) {
        portPenalty[portId] += 100
      }
    }
    return new TinyHyperGraphSolver(
      topology,
      {
        ...problem,
        initialAssignments,
        portPenalty,
        // The section optimizer's solved state has a zero search mask.
        // Open all ports for this separate, completed-graph search.
        portSectionMask: new Int8Array(topology.portCount).fill(1),
      },
      {
        MAX_ITERATIONS: Math.ceil(20_000 * Math.max(0.1, this.input.effort)),
        RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
      },
    )
  }

  private preservesOtherRoutes(
    candidate: TinyHyperGraphSolver,
    routeId: number,
  ): boolean {
    const segmentsForOtherRoutes = (solver: TinyHyperGraphSolver): string[] =>
      solver.state.regionSegments
        .flatMap((segments, regionId) =>
          segments
            .filter(([id]) => id !== routeId)
            .map(([id, from, to]) => `${regionId}:${id}:${from}:${to}`),
        )
        .sort()
    return (
      JSON.stringify(segmentsForOtherRoutes(candidate)) ===
      JSON.stringify(segmentsForOtherRoutes(this.selectedSolver))
    )
  }

  private countDistributedCrossings(solver: TinyHyperGraphSolver): number {
    const output = this.input.pathingSolver.getOutput(solver)
    const distribution = new UniformPortDistributionSolver({
      nodeWithPortPoints: output.nodesWithPortPoints,
      inputNodesWithPortPoints: output.inputNodeWithPortPoints,
      obstacles: this.input.obstacles,
    })
    distribution.solve()
    return distribution.getOutput().reduce((sum, node) => {
      const crossings = getIntraNodeCrossingsUsingCircle(node)
      return (
        sum +
        crossings.numSameLayerCrossings +
        crossings.numTransitionPairCrossings
      )
    }, 0)
  }

  override _step(): void {
    if (!this.candidate) {
      while (this.nextRouteIndex < this.routeWidths.length) {
        const route = this.routeWidths[this.nextRouteIndex++]
        if (
          this.getRouteClearance(this.selectedSolver, route.routeId) >=
          route.requestedWidth - 1e-6
        )
          continue
        this.currentRoute = route
        this.candidate = this.createCandidate(route)
        this.attemptedRouteCount++
        break
      }
      if (!this.candidate) {
        this.solved = true
        this.stats = {
          attemptedRouteCount: this.attemptedRouteCount,
          improvedRouteCount: this.improvedRouteCount,
          rejectedCrossingCount: this.rejectedCrossingCount,
        }
        return
      }
    }

    this.candidate.step()
    this.activeSubSolver = this.candidate
    if (!this.candidate.solved && !this.candidate.failed) return

    const improvesWidth =
      this.candidate.solved &&
      this.preservesOtherRoutes(this.candidate, this.currentRoute!.routeId) &&
      this.getRouteClearance(this.candidate, this.currentRoute!.routeId) >
        this.getRouteClearance(
          this.selectedSolver,
          this.currentRoute!.routeId,
        ) +
          1e-6
    if (improvesWidth) {
      const candidateCrossings = this.countDistributedCrossings(this.candidate)
      const originalCrossings = this.countDistributedCrossings(
        this.selectedSolver,
      )
      if (candidateCrossings <= originalCrossings) {
        this.selectedSolver = this.candidate
        this.improvedRouteCount++
        this.improvedConnectionIds.add(this.currentRoute!.connectionId)
      } else {
        this.rejectedCrossingCount++
      }
    }
    this.candidate = undefined
    this.currentRoute = undefined
    this.progress = this.nextRouteIndex / Math.max(1, this.routeWidths.length)
  }

  getOutput(): ReturnType<TinyHypergraphPortPointPathingSolver["getOutput"]> {
    return this.input.pathingSolver.getOutput(this.selectedSolver)
  }

  getImprovedConnectionIds(): ReadonlySet<string> {
    return this.improvedConnectionIds
  }

  computeNodePfMap(): Map<string, number | null> {
    return this.input.pathingSolver.computeNodePfMap(this.selectedSolver)
  }
}
