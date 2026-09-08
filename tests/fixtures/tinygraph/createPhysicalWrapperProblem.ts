import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { SegmentPortPoint } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { buildHyperGraph } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver"
import type { TinyHypergraphPortPointPathingSolverParams } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import type { CapacityMeshNode, SimpleRouteConnection } from "lib/types"

export function createPhysicalWrapperProblem(
  preloadOnly = false,
): TinyHypergraphPortPointPathingSolverParams {
  const nodes: CapacityMeshNode[] = [-2, 0, 2].map(
    (x, index): CapacityMeshNode => ({
      capacityMeshNodeId: `node-${index}`,
      center: { x, y: 0 },
      width: 2,
      height: 2,
      layer: "top",
      availableZ: [0],
    }),
  )
  const segmentPortPoints: SegmentPortPoint[] = []
  for (const edge of [0, 1]) {
    for (const y of preloadOnly ? [0] : [0, 0.6]) {
      const x = edge * 2 - 1
      segmentPortPoints.push({
        segmentPortPointId: `edge-${edge}-y-${y}`,
        x,
        y,
        availableZ: [0],
        nodeIds: [`node-${edge}`, `node-${edge + 1}`],
        edgeId: `edge-${edge}`,
        connectionName: null,
        distToCentermostPortOnZ: y,
        cramped: false,
        ...(preloadOnly
          ? {
              _preloadedFixedNetIds: ["preloaded-net"],
              _preloadedTracePortAssignments: [
                {
                  traceId: "preloaded-trace",
                  fixedNetId: "preloaded-net",
                  routePosition: edge,
                  tracePoint: { x, y: 0.4 },
                  z: 0,
                },
              ],
            }
          : {}),
      })
    }
  }
  const simpleRouteJsonConnections: SimpleRouteConnection[] = preloadOnly
    ? []
    : [
        {
          name: "route-a",
          __rootConnectionNames: ["net-a"],
          pointsToConnect: [
            { x: -2, y: 0, layer: "top" },
            { x: 2, y: 0, layer: "top" },
          ],
        },
      ]
  const connectivityMap = new ConnectivityMap({})
  connectivityMap.addConnections([["route-a", "net-a"]])
  const { graph, connections } = buildHyperGraph({
    capacityMeshNodes: nodes,
    segmentPortPoints,
    layerCount: 1,
    connectivityMap,
    simpleRouteJsonConnections,
  })
  return {
    graph,
    connections,
    layerCount: 1,
    effort: 0.1,
    flags: {
      FORCE_CENTER_FIRST: true,
      RIPPING_ENABLED: true,
      USE_SELECTIVE_RERIP_ROUTING: true,
    },
    weights: {
      SHUFFLE_SEED: 0,
      MEMORY_PF_FACTOR: 4,
      CENTER_OFFSET_DIST_PENALTY_FACTOR: 0,
      CENTER_OFFSET_FOCUS_SHIFT: 0,
      NODE_PF_FACTOR: 0,
      LAYER_CHANGE_COST: 0,
      RIPPING_PF_COST: 0,
      NODE_PF_MAX_PENALTY: 100,
      BASE_CANDIDATE_COST: 0.6,
      MAX_ITERATIONS_PER_PATH: 0,
      RANDOM_WALK_DISTANCE: 0,
      START_RIPPING_PF_THRESHOLD: 0.3,
      END_RIPPING_PF_THRESHOLD: 1,
      MAX_RIPS: 1000,
      RANDOM_RIP_FRACTION: 0.3,
      STRAIGHT_LINE_DEVIATION_PENALTY_FACTOR: 4,
      GREEDY_MULTIPLIER: 0.7,
      MIN_ALLOWED_BOARD_SCORE: -10000,
    },
  }
}
