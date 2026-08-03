import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { buildHyperGraph } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import type { CapacityMeshNode, SimpleRouteConnection } from "lib/types"

const CONNECTION_COUNT = 181

test("large graphs skip duplicate-congested-port repair", () => {
  const capacityMeshNodes: CapacityMeshNode[] = [
    { capacityMeshNodeId: "west", x: -2 },
    { capacityMeshNodeId: "center", x: 0 },
    { capacityMeshNodeId: "east", x: 2 },
  ].map(({ capacityMeshNodeId, x }) => ({
    capacityMeshNodeId,
    center: { x, y: 0 },
    width: 2,
    height: 2,
    layer: "top",
    availableZ: [0],
  }))
  const simpleRouteJsonConnections: SimpleRouteConnection[] = Array.from(
    { length: CONNECTION_COUNT },
    (_, index) => ({
      name: `route-${index}`,
      pointsToConnect: [
        { x: -2, y: 0, layer: "top" },
        { x: 2, y: 0, layer: "top" },
      ],
    }),
  )
  const connectivityMap = new ConnectivityMap(
    Object.fromEntries(
      simpleRouteJsonConnections.map((connection) => [
        `net-${connection.name}`,
        [connection.name],
      ]),
    ),
  )
  const { graph, connections } = buildHyperGraph({
    capacityMeshNodes,
    segmentPortPoints: [
      {
        segmentPortPointId: "west-center",
        x: -1,
        y: 0,
        availableZ: [0],
        nodeIds: ["west", "center"],
        edgeId: "west-center-edge",
        connectionName: null,
        distToCentermostPortOnZ: 0,
        cramped: false,
      },
      {
        segmentPortPointId: "center-east",
        x: 1,
        y: 0,
        availableZ: [0],
        nodeIds: ["center", "east"],
        edgeId: "center-east-edge",
        connectionName: null,
        distToCentermostPortOnZ: 0,
        cramped: false,
      },
    ],
    layerCount: 1,
    connectivityMap,
    simpleRouteJsonConnections,
  })
  const solver = new TinyHypergraphPortPointPathingSolver({
    graph,
    connections,
    layerCount: 1,
    effort: 0.01,
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
  })

  solver.step()

  expect(solver.stats).toMatchObject({
    duplicateCongestedPortSourceCount: 0,
    duplicateCongestedPortCount: 0,
    duplicateCongestedPortFallbackToOriginal: true,
    duplicateCongestedPortError: `Skipped for ${CONNECTION_COUNT} connections`,
  })
})
