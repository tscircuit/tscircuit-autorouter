import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { SegmentPortPoint } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { buildHyperGraph } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import type { CapacityMeshNode, SimpleRouteConnection } from "lib/types"

test("physical port capacity rejects a fabricated portal", () => {
  const capacityMeshNodes: CapacityMeshNode[] = [
    {
      capacityMeshNodeId: "west",
      center: { x: -1, y: 0 },
      width: 2,
      height: 2,
      layer: "top",
      availableZ: [0],
    },
    {
      capacityMeshNodeId: "east",
      center: { x: 1, y: 0 },
      width: 2,
      height: 2,
      layer: "top",
      availableZ: [0],
    },
  ]
  const segmentPortPoints: SegmentPortPoint[] = [
    {
      segmentPortPointId: "portal",
      edgeId: "edge-west-east",
      nodeIds: ["west", "east"],
      x: 0,
      y: 0,
      availableZ: [0],
      connectionName: null,
      distToCentermostPortOnZ: 0,
      cramped: false,
    },
  ]
  const simpleRouteJsonConnections: SimpleRouteConnection[] = [
    {
      name: "route-a",
      __rootConnectionNames: ["root-a"],
      pointsToConnect: [
        { x: -1.5, y: 0, layer: "top" },
        { x: 1.5, y: 0, layer: "top" },
      ],
    },
  ]
  const connectivityMap = new ConnectivityMap({})
  connectivityMap.addConnections([["route-a", "root-a"]])
  const { graph, connections } = buildHyperGraph({
    capacityMeshNodes,
    segmentPortPoints,
    simpleRouteJsonConnections,
    layerCount: 1,
    connectivityMap,
    includePhysicalPortalMetadata: true,
  })
  graph.ports[0]!.d.duplicatedFromPortId = "source-portal"

  expect(
    () =>
      new TinyHypergraphPortPointPathingSolver({
        graph,
        connections,
        layerCount: 1,
        effort: 0.1,
        enforcePhysicalPortCapacity: true,
        flags: { FORCE_CENTER_FIRST: true, RIPPING_ENABLED: true },
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
          MAX_RIPS: 100,
          RANDOM_RIP_FRACTION: 0.3,
          STRAIGHT_LINE_DEVIATION_PENALTY_FACTOR: 4,
          GREEDY_MULTIPLIER: 0.7,
          MIN_ALLOWED_BOARD_SCORE: -10000,
        },
      }),
  ).toThrow("Physical port capacity mode received 1 fabricated portal")
})
