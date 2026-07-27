import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { buildHyperGraph } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import type {
  CapacityMeshNode,
  SimpleRouteConnection,
} from "lib/types"

test("congestion duplicates do not inherit preloaded port ownership", () => {
  const capacityMeshNodes: CapacityMeshNode[] = [
    {
      capacityMeshNodeId: "left",
      center: { x: -2, y: 0 },
      width: 2,
      height: 2,
      layer: "top",
      availableZ: [0],
    },
    {
      capacityMeshNodeId: "middle",
      center: { x: 0, y: 0 },
      width: 2,
      height: 2,
      layer: "top",
      availableZ: [0],
    },
    {
      capacityMeshNodeId: "right",
      center: { x: 2, y: 0 },
      width: 2,
      height: 2,
      layer: "top",
      availableZ: [0],
    },
  ]
  const simpleRouteJsonConnections: SimpleRouteConnection[] = [
    {
      name: "fixed-route",
      __rootConnectionNames: ["fixed-root"],
      pointsToConnect: [
        { x: -2, y: 0.2, layer: "top" },
        { x: 2, y: 0.2, layer: "top" },
      ],
    },
    {
      name: "foreign-route",
      __rootConnectionNames: ["foreign-root"],
      pointsToConnect: [
        { x: -2, y: -0.2, layer: "top" },
        { x: 2, y: -0.2, layer: "top" },
      ],
    },
  ]
  const connectivityMap = new ConnectivityMap({})
  connectivityMap.addConnections([["fixed-route", "fixed-root"]])
  connectivityMap.addConnections([["foreign-route", "foreign-root"]])
  const { graph, connections } = buildHyperGraph({
    capacityMeshNodes,
    segmentPortPoints: [
      {
        segmentPortPointId: "left-middle",
        x: -1,
        y: 0,
        availableZ: [0],
        nodeIds: ["left", "middle"],
        edgeId: "left-middle-edge",
        connectionName: "fixed-route",
        rootConnectionName: "fixed-root",
        distToCentermostPortOnZ: 0,
        cramped: false,
        _preloadedFixedNetIds: ["fixed-root"],
      },
      {
        segmentPortPointId: "middle-right",
        x: 1,
        y: 0,
        availableZ: [0],
        nodeIds: ["middle", "right"],
        edgeId: "middle-right-edge",
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
  })
  const serializedGraph = (solver as any).tinyPipelineSolver.inputProblem
    .serializedHyperGraph
  const sourcePort = serializedGraph.ports.find(
    (port: any) => port.portId === "left-middle::0",
  )
  const duplicatePorts = serializedGraph.ports.filter(
    (port: any) => port.d?.duplicatedFromPortId === "left-middle::0",
  )

  expect(sourcePort?.d?._preloadedFixedNetIds).toEqual(["fixed-root"])
  expect(duplicatePorts.length).toBeGreaterThan(0)
  expect(
    duplicatePorts.every(
      (port: any) => port.d?._preloadedFixedNetIds === undefined,
    ),
  ).toBe(true)
})
