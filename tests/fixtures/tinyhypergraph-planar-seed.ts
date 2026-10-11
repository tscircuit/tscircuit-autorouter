import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { loadSerializedHyperGraph } from "tiny-hypergraph/lib/index"
import { SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments"
import { initializePlanarBoundarySeed } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/initializePlanarBoundarySeed"
import type { IndependentRouteSegment } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/DuplicateCongestedPortSolverWithIndependentRoutes"

type PlanarSeedStateSnapshot = {
  regionSegments: Array<[number, number, number][]>
  portAssignment: Int32Array
  regionIntersectionCaches: unknown
  unroutedRoutes: number[]
  regionCongestionCost: Float64Array
  routeSuccessCounts: Uint32Array
  stats: unknown
  initialAssignments: unknown
}

export class PlanarSeedTestSolver extends SelectiveReripTinyHyperGraphSolverWithStableInitialAssignments {
  readonly routeSuccessCountsForTest = this.routeSuccessCountByRouteId

  initializePlanarSeed(
    segments: readonly IndependentRouteSegment[],
  ): ReturnType<typeof initializePlanarBoundarySeed> {
    return initializePlanarBoundarySeed(this, segments, this.routeSuccessCountByRouteId)
  }
}

export const createPlanarSeedFixture = (): {
  graph: SerializedHyperGraph
  segments: IndependentRouteSegment[]
} => {
  const regionDefinitions: Array<[string, number, number, string[]]> = [
    ["upper-start", -2.2, 0.5, ["upper-in"]],
    ["lower-start", -2.2, -0.5, ["lower-in"]],
    ["left", -1, 0, ["upper-in", "lower-in", "boundary-top", "boundary-bottom", "boundary-other-layer"]],
    ["right", 1, 0, ["upper-out", "lower-out", "boundary-top", "boundary-bottom", "boundary-other-layer"]],
    ["upper-end", 2.2, 0.5, ["upper-out"]],
    ["lower-end", 2.2, -0.5, ["lower-out"]],
  ]
  const portDefinitions: Array<[string, string, string, number, number, number]> = [
    ["upper-in", "upper-start", "left", -2, 0.5, 0],
    ["lower-in", "lower-start", "left", -2, -0.5, 0],
    ["boundary-top", "left", "right", 0, 0.5, 0],
    ["boundary-bottom", "left", "right", 0, -0.5, 0],
    ["boundary-other-layer", "left", "right", 0, 0, 1],
    ["upper-out", "right", "upper-end", 2, 0.5, 0],
    ["lower-out", "right", "lower-end", 2, -0.5, 0],
  ]
  return {
    graph: {
      regions: regionDefinitions.map(([regionId, x, y, pointIds]) => ({
        regionId,
        pointIds,
        d: { center: { x, y }, width: regionId === "left" || regionId === "right" ? 2 : 0.4, height: regionId === "left" || regionId === "right" ? 2 : 0.4, availableZ: [0, 1] },
      })),
      ports: portDefinitions.map(([portId, region1Id, region2Id, x, y, z]) => ({
        portId,
        region1Id,
        region2Id,
        d: { x, y, z },
      })),
      connections: [
        { connectionId: "upper-route", startRegionId: "upper-start", endRegionId: "upper-end", mutuallyConnectedNetworkId: "upper-net" },
        { connectionId: "lower-route", startRegionId: "lower-start", endRegionId: "lower-end", mutuallyConnectedNetworkId: "lower-net" },
      ],
    },
    segments: [
      { connectionId: "upper-route", regionId: "left", fromPortId: "upper-in", toPortId: "boundary-bottom" },
      { connectionId: "upper-route", regionId: "right", fromPortId: "boundary-bottom", toPortId: "upper-out" },
      { connectionId: "lower-route", regionId: "left", fromPortId: "lower-in", toPortId: "boundary-top" },
      { connectionId: "lower-route", regionId: "right", fromPortId: "boundary-top", toPortId: "lower-out" },
    ],
  }
}

export const createPlanarSeedTestSolver = (
  graph: SerializedHyperGraph,
): PlanarSeedTestSolver => {
  const { topology, problem } = loadSerializedHyperGraph(graph)
  return new PlanarSeedTestSolver(topology, problem, {
    STATIC_REACHABILITY_PRECHECK: false,
    PARTIAL_RIP_ENABLED: false,
    OUTSIDE_IN_ROUTING: false,
    RIP_THRESHOLD_RAMP_ATTEMPTS: 2,
    RIP_THRESHOLD_START: 0.05,
    RIP_THRESHOLD_END: 0.8,
  })
}

export const getPlanarSeedBoundaryPorts = (
  solver: PlanarSeedTestSolver,
  routeId: number,
): number[] => {
  const ports = new Set<number>()
  for (const segments of solver.state.regionSegments) {
    for (const [segmentRouteId, fromPortId, toPortId] of segments) {
      if (segmentRouteId !== routeId) continue
      for (const portId of [fromPortId, toPortId]) {
        const id = solver.topology.portMetadata![portId].serializedPortId
        if (typeof id === "string" && id.startsWith("boundary-")) ports.add(portId)
      }
    }
  }
  return [...ports]
}

export const snapshotPlanarSeedState = (
  solver: PlanarSeedTestSolver,
): PlanarSeedStateSnapshot => {
  return {
    regionSegments: structuredClone(solver.state.regionSegments),
    portAssignment: new Int32Array(solver.state.portAssignment),
    regionIntersectionCaches: structuredClone(solver.state.regionIntersectionCaches),
    unroutedRoutes: [...solver.state.unroutedRoutes],
    regionCongestionCost: new Float64Array(solver.state.regionCongestionCost),
    routeSuccessCounts: new Uint32Array(solver.routeSuccessCountsForTest),
    stats: structuredClone(solver.stats),
    initialAssignments: structuredClone(solver.problem.initialAssignments),
  }
}
