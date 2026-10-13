import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import {
  DistanceAwareTinyHyperGraphSolver,
  loadSerializedHyperGraph,
} from "tiny-hypergraph/lib/index"
import { computeRegionCost } from "tiny-hypergraph/lib/computeRegionCost"

export class LandmarkHeuristicTestSolver extends DistanceAwareTinyHyperGraphSolver {
  readonly routeSuccessCountsForTest = this.routeSuccessCountByRouteId
}

export const createDetourFixture = (deadEndCount = 4): SerializedHyperGraph => {
  const definitions: Array<[string, string, string, number, number, number]> = [
    ["start-port", "start", "fork", -3, 0, 0],
    ["upper-left", "fork", "upper", -1, 2, 0],
    ["upper-right", "upper", "merge", 1, 2, 0],
    ["lower-left", "fork", "lower", -1, -4, 0],
    ["lower-right", "lower", "merge", 1, -4, 1],
    ["goal-port", "merge", "end", 3, 0, 0],
    ["island-left", "island-a", "island", 0, 0.1, 0],
    ["island-right", "island", "island-b", 0.1, 0.1, 0],
  ]
  for (let index = 0; index < deadEndCount; index++) {
    definitions.push([
      `leaf-port-${index}`,
      "fork",
      `leaf-${index}`,
      2.6 + index / (deadEndCount + 1) / 4,
      0.1,
      0,
    ])
  }
  const regionIds = [
    ...new Set(
      definitions.flatMap(([, first, second]): string[] => [first, second]),
    ),
  ]
  return {
    regions: regionIds.map(
      (regionId): SerializedHyperGraph["regions"][number] => ({
        regionId,
        pointIds: definitions
          .filter(
            ([, first, second]): boolean =>
              first === regionId || second === regionId,
          )
          .map(([portId]): string => portId),
        d: {
          center: { x: 0, y: 0 },
          width: 1,
          height: 1,
          availableZ: [0, 1],
        },
      }),
    ),
    ports: definitions.map(
      ([portId, region1Id, region2Id, x, y, z]): SerializedHyperGraph["ports"][number] => ({
        portId,
        region1Id,
        region2Id,
        d: {
          x,
          y,
          z,
          tinyHypergraphPortPenalty:
            portId === "upper-left" ? 0.02 : portId === "lower-right" ? 0.03 : 0,
        },
      }),
    ),
    connections: [
      {
        connectionId: "detour",
        startRegionId: "start",
        endRegionId: "end",
        mutuallyConnectedNetworkId: "detour-net",
      },
    ],
  }
}

export const createDetourSolver = (
  graph: SerializedHyperGraph,
): LandmarkHeuristicTestSolver => {
  const { topology, problem } = loadSerializedHyperGraph(graph)
  problem.portPenalty = new Float64Array(topology.portCount)
  for (let portId = 0; portId < topology.portCount; portId++) {
    problem.portPenalty[portId] =
      (graph.ports[portId]!.d?.tinyHypergraphPortPenalty as number | undefined) ?? 0
  }
  return new LandmarkHeuristicTestSolver(topology, problem, {
    STATIC_REACHABILITY_PRECHECK: false,
    RIP_THRESHOLD_RAMP_ATTEMPTS: 0,
    TRACE_DENSITY_COST_FACTOR: 0.7,
  })
}

/** Independent all-pairs reference for the static relaxed graph. */
export const getReferenceDistances = (
  solver: DistanceAwareTinyHyperGraphSolver,
): { edges: number[][]; distances: number[][] } => {
  const { topology } = solver
  const edges = Array.from(
    { length: topology.portCount },
    (_, first): number[] =>
      Array.from(
        { length: topology.portCount },
        (_, second): number =>
          first === second ? 0 : Number.POSITIVE_INFINITY,
      ),
  )
  for (let regionId = 0; regionId < topology.regionCount; regionId++) {
    const ports = topology.regionIncidentPorts[regionId]!
    for (const first of ports) {
      for (const second of ports) {
        if (first === second) continue
        const kernel = computeRegionCost(
          topology.regionWidth[regionId]!,
          topology.regionHeight[regionId]!,
          0,
          0,
          topology.portZ[first] === topology.portZ[second] ? 0 : 1,
          1,
          topology.regionAvailableZMask?.[regionId] ?? 0,
          solver.minViaPadDiameter,
          solver.TRACE_DENSITY_COST_FACTOR,
        )
        const weight =
          Math.hypot(
            topology.portX[first]! - topology.portX[second]!,
            topology.portY[first]! - topology.portY[second]!,
          ) * solver.DISTANCE_TO_COST +
          (solver.problem.portPenalty?.[second] ?? 0) +
          kernel
        edges[first]![second] = Math.min(edges[first]![second]!, weight)
      }
    }
  }
  const distances = edges.map((row): number[] => [...row])
  for (let middle = 0; middle < topology.portCount; middle++) {
    for (let first = 0; first < topology.portCount; first++) {
      for (let second = 0; second < topology.portCount; second++) {
        distances[first]![second] = Math.min(
          distances[first]![second]!,
          distances[first]![middle]! + distances[middle]![second]!,
        )
      }
    }
  }
  return { edges, distances }
}
