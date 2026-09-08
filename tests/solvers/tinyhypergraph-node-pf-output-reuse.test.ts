import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { SegmentPortPoint } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { buildHyperGraph } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import type { CapacityMeshNode } from "lib/types"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

type TinyPathingOutput = ReturnType<
  TinyHypergraphPortPointPathingSolver["getOutput"]
>

class OutputCountingTinyPathingSolver extends TinyHypergraphPortPointPathingSolver {
  outputReadCount = 0
  outputNodeCounts: number[] = []

  override getOutput(): TinyPathingOutput {
    const output = super.getOutput()
    this.outputReadCount += 1
    this.outputNodeCounts.push(output.nodesWithPortPoints.length)
    return output
  }
}

test("TinyHypergraph node Pf reuses output without changing results", (): void => {
  const capacityMeshNodes: CapacityMeshNode[] = Array.from(
    { length: 4 },
    (_, index): CapacityMeshNode => ({
      capacityMeshNodeId: `node-${index}`,
      center: { x: index * 2, y: 0 },
      width: 2,
      height: 2,
      layer: "top",
      availableZ: [0],
    }),
  )
  const segmentPortPoints: SegmentPortPoint[] = Array.from(
    { length: 2 },
    (_, index): SegmentPortPoint => ({
      segmentPortPointId: `port-${index}`,
      x: index * 2 + 1,
      y: 0,
      availableZ: [0],
      nodeIds: [`node-${index}`, `node-${index + 1}`],
      edgeId: `edge-${index}`,
      connectionName: null,
      distToCentermostPortOnZ: 0,
      cramped: false,
    }),
  )
  const connectivityMap = new ConnectivityMap({})
  connectivityMap.addConnections([["horizontal", "horizontal-net"]])
  const { graph, connections } = buildHyperGraph({
    capacityMeshNodes,
    segmentPortPoints,
    layerCount: 1,
    connectivityMap,
    simpleRouteJsonConnections: [
      {
        name: "horizontal",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top" },
          { x: 4, y: 0, layer: "top" },
        ],
      },
    ],
  })
  const solver = new OutputCountingTinyPathingSolver({
    graph,
    connections,
    layerCount: 1,
    effort: 0.1,
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
      MAX_RIPS: 1000,
      RANDOM_RIP_FRACTION: 0.3,
      STRAIGHT_LINE_DEVIATION_PENALTY_FACTOR: 4,
      GREEDY_MULTIPLIER: 0.7,
      MIN_ALLOWED_BOARD_SCORE: -10000,
    },
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const output = solver.getOutput()
  const outputBefore = structuredClone(output)
  const nodesWithPortPoints = Object.freeze(output.nodesWithPortPoints)
  const readCountBeforeDefault = solver.outputReadCount
  const defaultNodePf = output.inputNodeWithPortPoints.map(
    (node): number | null => solver.computeNodePf(node),
  )
  expect(solver.outputReadCount - readCountBeforeDefault).toBe(
    output.inputNodeWithPortPoints.length,
  )
  const readCountBeforeSnapshot = solver.outputReadCount
  expect(
    output.inputNodeWithPortPoints.map(
      (node): number | null => solver.computeNodePf(node, nodesWithPortPoints),
    ),
  ).toEqual(defaultNodePf)
  const centerNode = output.inputNodeWithPortPoints.find(
    (node): boolean => node.capacityMeshNodeId === "node-1",
  )
  const routedCenterNode = nodesWithPortPoints.find(
    (node): boolean => node.capacityMeshNodeId === "node-1",
  )
  const unusedNode = output.inputNodeWithPortPoints.find(
    (node): boolean => node.capacityMeshNodeId === "node-3",
  )
  if (!centerNode || !routedCenterNode || !unusedNode) {
    throw new Error("Expected routed center and unused node in test graph")
  }
  const crossingCenterNode: NodeWithPortPoints = {
    ...routedCenterNode,
    portPoints: [
      { connectionName: "horizontal", x: 1, y: 0, z: 0 },
      { connectionName: "horizontal", x: 3, y: 0, z: 0 },
      { connectionName: "vertical", x: 2, y: -1, z: 0 },
      { connectionName: "vertical", x: 2, y: 1, z: 0 },
    ],
  }
  expect(
    solver.computeNodePf(centerNode, [crossingCenterNode, routedCenterNode]),
  ).toBe(1)
  expect(
    solver.computeNodePf(centerNode, [routedCenterNode, crossingCenterNode]),
  ).toBe(0)
  expect(solver.computeNodePf(centerNode, [])).toBeNull()
  expect(solver.computeNodePf(unusedNode, nodesWithPortPoints)).toBeNull()
  const missingNode = { ...centerNode, capacityMeshNodeId: "missing" }
  expect(solver.computeNodePf(missingNode, nodesWithPortPoints)).toBeNull()
  expect(
    solver.computeNodePf(missingNode, [
      { ...routedCenterNode, capacityMeshNodeId: "missing" },
    ]),
  ).toBeNull()
  expect(solver.outputReadCount).toBe(readCountBeforeSnapshot)
  expect(output).toEqual(outputBefore)
  expect(solver.getOutput()).toEqual(outputBefore)
  expect(
    solver.outputNodeCounts.every(
      (nodeCount): boolean => nodeCount === nodesWithPortPoints.length,
    ),
  ).toBe(true)
})
