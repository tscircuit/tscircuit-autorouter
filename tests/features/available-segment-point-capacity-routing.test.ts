import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getSvgFromGraphicsObject } from "graphics-debug"
import type { SegmentPortPoint } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { buildHyperGraph } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import type { CapacityMeshNode, SimpleRouteConnection } from "lib/types"

test("available segment point capacity reroutes overflow through legal shared-edge points", () => {
  const capacityMeshNodes: CapacityMeshNode[] = [
    {
      capacityMeshNodeId: "west",
      center: { x: -2, y: 0 },
      width: 2,
      height: 4,
    },
    {
      capacityMeshNodeId: "upper",
      center: { x: 0, y: 1 },
      width: 2,
      height: 2,
    },
    {
      capacityMeshNodeId: "lower",
      center: { x: 0, y: -1 },
      width: 2,
      height: 2,
    },
    { capacityMeshNodeId: "east", center: { x: 2, y: 0 }, width: 2, height: 4 },
  ].map((node) => ({ ...node, layer: "top", availableZ: [0] }))
  const createSegmentPortPoint = (
    id: string,
    x: number,
    y: number,
    nodeIds: [string, string],
  ): SegmentPortPoint => ({
    segmentPortPointId: id,
    edgeId: `edge-${id}`,
    nodeIds,
    x,
    y,
    availableZ: [0],
    connectionName: null,
    distToCentermostPortOnZ: 0,
    cramped: false,
  })
  const simpleRouteJsonConnections: SimpleRouteConnection[] = [
    "route-a",
    "route-b",
  ].map((name, index) => ({
    name,
    __rootConnectionNames: [`root-${index}`],
    pointsToConnect: [
      { x: -2.5, y: 0, layer: "top" },
      { x: 2.5, y: 0, layer: "top" },
    ],
  }))
  const connectivityMap = new ConnectivityMap({})
  connectivityMap.addConnections([
    ["route-a", "root-0"],
    ["route-b", "root-1"],
  ])
  const segmentPortPoints = [
    createSegmentPortPoint("west-upper", -1, 1, ["west", "upper"]),
    createSegmentPortPoint("upper-east", 1, 1, ["upper", "east"]),
    createSegmentPortPoint("west-lower", -1, -1, ["west", "lower"]),
    createSegmentPortPoint("lower-east", 1, -1, ["lower", "east"]),
  ]
  const { graph, connections } = buildHyperGraph({
    capacityMeshNodes,
    segmentPortPoints,
    layerCount: 1,
    connectivityMap,
    simpleRouteJsonConnections,
  })
  const solver = new TinyHypergraphPortPointPathingSolver({
    graph,
    connections,
    layerCount: 1,
    effort: 0.1,
    enforceAvailableSegmentPointCapacity: true,
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
  })

  solver.solve()

  const availableSegmentPointIds = new Set(
    segmentPortPoints.map((point) => `${point.segmentPortPointId}::0`),
  )
  const assignedAvailableSegmentPoints = solver
    .getOutput()
    .nodesWithPortPoints.flatMap((node) => node.portPoints)
    .filter(
      (portPoint) =>
        portPoint.portPointId !== undefined &&
        availableSegmentPointIds.has(portPoint.portPointId),
    )
  const rootsBySlot = new Map<string, Set<string>>()
  for (const portPoint of assignedAvailableSegmentPoints) {
    const roots = rootsBySlot.get(portPoint.portPointId!) ?? new Set()
    roots.add(portPoint.rootConnectionName ?? portPoint.connectionName)
    rootsBySlot.set(portPoint.portPointId!, roots)
  }

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(solver.stats.duplicateCongestedPortCount).toBe(0)
  expect(
    new Set(assignedAvailableSegmentPoints.map((point) => point.portPointId)),
  ).toEqual(availableSegmentPointIds)
  expect(
    new Set(
      assignedAvailableSegmentPoints.map(
        (point) => point.rootConnectionName ?? point.connectionName,
      ),
    ),
  ).toEqual(new Set(["root-0", "root-1"]))
  expect(
    [...rootsBySlot.values()].every((roots) => roots.size === 1),
  ).toBeTrue()
  expect(getSvgFromGraphicsObject(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})
