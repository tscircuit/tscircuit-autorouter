import { TinyHyperGraphSolver, type TinyHyperGraphProblem } from "tiny-hypergraph/lib/index"

/** Search one alternate route while retaining every other committed assignment. */
export class RegionAvoidingRouteSolver extends TinyHyperGraphSolver {
  searchExhausted = false

  constructor(
    incumbent: TinyHyperGraphSolver,
    readonly routeId: number,
    readonly avoidedRegionId: number,
    maxIterations: number,
    portSectionMask: Int8Array,
  ) {
    const initialAssignments: NonNullable<TinyHyperGraphProblem["initialAssignments"]> = []
    for (let regionId = 0; regionId < incumbent.topology.regionCount; regionId++) {
      for (const [assignedRouteId, fromPortId, toPortId] of incumbent.state.regionSegments[regionId]) {
        if (assignedRouteId === routeId) continue
        initialAssignments.push({ routeId: assignedRouteId, regionId, fromPortId, toPortId })
      }
    }
    super(incumbent.topology, { ...incumbent.problem, initialAssignments, portSectionMask: new Int8Array(portSectionMask) }, {
      minViaPadDiameter: incumbent.minViaPadDiameter,
      STATIC_REACHABILITY_PRECHECK: false,
      MAX_ITERATIONS: maxIterations + 1,
      ACCEPT_BEST_SOLUTION_ON_TIMEOUT: false,
      USE_SPARSE_CANDIDATE_STORAGE: true,
    })
    if (this.state.unroutedRoutes.length !== 1 || this.state.unroutedRoutes[0] !== routeId) {
      throw new Error(`RegionAvoidingRouteSolver: expected only route ${routeId} to be unrouted`)
    }
  }

  override isRegionReservedForDifferentNet(regionId: number): boolean {
    const isAvoidedRegion =
      this.state.currentRouteId === this.routeId &&
      regionId === this.avoidedRegionId
    return isAvoidedRegion || super.isRegionReservedForDifferentNet(regionId)
  }

  override onOutOfCandidates(): void {
    // Expected search exhaustion is explicit; internal errors remain fatal.
    this.searchExhausted = true
    this.failed = true
    this.error = `No alternate path for route ${this.routeId} avoiding region ${this.avoidedRegionId}`
    this.state.candidateQueue.clear()
  }

  override onAllRoutesRouted(): void {
    if (this.state.unroutedRoutes.length !== 0 || this.state.currentRouteId !== undefined) {
      throw new Error("RegionAvoidingRouteSolver: completed with an unfinished route")
    }
    this.solved = true
    this.progress = 1
  }
}
