import {
  SelectiveReripTinyHyperGraphSolver,
  type TinyHyperGraphProblem,
  type TinyHyperGraphProblemSetup,
  type TinyHyperGraphSolver,
  type TinyHyperGraphSolverOptions,
  type TinyHyperGraphTopology,
} from "tiny-hypergraph/lib/index"
import { applyInitialAssignments } from "tiny-hypergraph/lib/initialAssignments"
import type { RegionIntersectionCache } from "tiny-hypergraph/lib/types"
import type { TinyGraphFixedCopperClearanceContext } from "./createTinyGraphFixedCopperClearanceContext"
import { getTinyGraphFixedCopperPortReservations } from "./getTinyGraphFixedCopperPortReservations"

type TinyGraphSolvedStateSnapshot = {
  portAssignment: Int32Array
  regionSegments: Array<[number, number, number][]>
  regionIntersectionCaches: RegionIntersectionCache[]
  regionCongestionCost: Float64Array
  ripCount: number
}

/**
 * Selective rerips may move a preloaded assignment when it is the blocker.
 * A global retry restores the serialized assignments instead of eagerly
 * discarding every preloaded route.
 */
export class SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments extends SelectiveReripTinyHyperGraphSolver {
  private initialAssignmentRouteIds?: ReadonlySet<number>
  private readonly fixedCopperContext?: TinyGraphFixedCopperClearanceContext
  private fixedCopperPortReservations?: Int32Array

  constructor(
    topology: TinyHyperGraphTopology,
    problem: TinyHyperGraphProblem,
    options?: TinyHyperGraphSolverOptions,
    fixedCopperContext?: TinyGraphFixedCopperClearanceContext,
  ) {
    super(topology, problem, options)
    if (fixedCopperContext) {
      if (fixedCopperContext.loadedProblem !== problem) {
        throw new Error(
          "TinyGraph fixed copper context must match the loaded problem",
        )
      }
      this.fixedCopperContext = {
        ...fixedCopperContext,
        canonicalNetIdByNetId: new Map(fixedCopperContext.canonicalNetIdByNetId),
        netIdByCanonicalNetId: new Map(fixedCopperContext.netIdByCanonicalNetId),
        connectionIdByRouteId: [...fixedCopperContext.connectionIdByRouteId],
      }
    }
  }

  private applyFixedCopperReservations(
    setup: TinyHyperGraphProblemSetup,
  ): void {
    if (!this.fixedCopperContext) return
    this.fixedCopperPortReservations ??=
      getTinyGraphFixedCopperPortReservations({
        topology: this.topology,
        context: this.fixedCopperContext,
      })
    const reservations = setup.portEndpointReservationNetId
    for (let portId = 0; portId < this.topology.portCount; portId++) {
      const physical = this.fixedCopperPortReservations[portId]!
      const original = reservations[portId]!
      if (physical === -1 || original === -2) continue
      reservations[portId] =
        original === -1 || original === physical ? physical : -2
    }
  }

  private assertEndpointAllowed(
    routeId: number,
    portId: number,
    endpoint: "start" | "end",
    reservations: Int32Array,
  ): void {
    if (!this.fixedCopperContext) return
    const netId = this.problem.routeNet[routeId]
    const reservation = reservations[portId]
    const connectionId = this.fixedCopperContext.connectionIdByRouteId[routeId]
    if (
      netId === undefined ||
      connectionId === undefined ||
      reservation === undefined ||
      reservation === -2 ||
      (reservation !== -1 && reservation !== netId)
    ) {
      throw new Error(
        `TinyGraph connection "${connectionId}" route ${routeId} ${endpoint} port ${portId} violates its fixed-copper/endpoint reservation`,
      )
    }
  }

  override computeProblemSetup(): TinyHyperGraphProblemSetup {
    const setup = super.computeProblemSetup()
    this.applyFixedCopperReservations(setup)
    if (this.fixedCopperContext) {
      // Preserved assignments use logical portals, not newly generated copper.
      for (const routeId of this.state.unroutedRoutes) {
        this.assertEndpointAllowed(
          routeId,
          super.getRouteStartPortId(routeId),
          "start",
          setup.portEndpointReservationNetId,
        )
        this.assertEndpointAllowed(
          routeId,
          super.getRouteEndPortId(routeId),
          "end",
          setup.portEndpointReservationNetId,
        )
      }
    }
    return setup
  }

  protected override getRouteStartPortId(routeId: number): number {
    const portId = super.getRouteStartPortId(routeId)
    if (this.fixedCopperContext && this.state.currentRouteId === routeId) {
      this.assertEndpointAllowed(
        routeId,
        portId,
        "start",
        this.problemSetup.portEndpointReservationNetId,
      )
    }
    return portId
  }

  protected override getRouteEndPortId(routeId: number): number {
    const portId = super.getRouteEndPortId(routeId)
    if (this.fixedCopperContext && this.state.currentRouteId === routeId) {
      this.assertEndpointAllowed(
        routeId,
        portId,
        "end",
        this.problemSetup.portEndpointReservationNetId,
      )
    }
    return portId
  }

  protected override applySnapshotToGreedyFinalRouteSolver(
    solver: TinyHyperGraphSolver,
    snapshot: TinyGraphSolvedStateSnapshot,
    routeIds: number[],
  ): void {
    super.applySnapshotToGreedyFinalRouteSolver(solver, snapshot, routeIds)
    if (!this.fixedCopperContext) return
    this.applyFixedCopperReservations(solver.problemSetup)
    for (const routeId of routeIds) {
      this.assertEndpointAllowed(
        routeId,
        solver.problem.routeStartPort[routeId]!,
        "start",
        solver.problemSetup.portEndpointReservationNetId,
      )
      this.assertEndpointAllowed(
        routeId,
        solver.problem.routeEndPort[routeId]!,
        "end",
        solver.problemSetup.portEndpointReservationNetId,
      )
    }
  }

  protected override getRouteIdsPreferredForPreservation(): ReadonlySet<number> {
    if (!this.initialAssignmentRouteIds) {
      this.initialAssignmentRouteIds = new Set(
        (this.problem.initialAssignments ?? []).map(
          (assignment) => assignment.routeId,
        ),
      )
    }
    return this.initialAssignmentRouteIds
  }

  override resetRoutingStateForRerip(): void {
    super.resetRoutingStateForRerip()
    if (!this.problem.initialAssignments?.length) return

    applyInitialAssignments({
      topology: this.topology,
      problem: this.problem,
      state: this.state,
      routeSuccessCountByRouteId: this.routeSuccessCountByRouteId,
      appendSegmentToRegionCache: (regionId, fromPortId, toPortId) =>
        this.appendSegmentToRegionCache(regionId, fromPortId, toPortId),
    })
  }
}
