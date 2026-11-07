import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { AvailableSegmentPointSolver } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { CapacityMeshEdgeSolver2_NodeTreeOptimization } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver2_NodeTreeOptimization"
import { buildHyperGraph } from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import type { CapacityMeshNode } from "lib/types"

test("numerical gap ports preserve continuous routes and still connect isolated regions", () => {
  for (const hasContinuousPath of [true, false]) {
    const nodes: CapacityMeshNode[] = [
      {
        capacityMeshNodeId: "west",
        center: { x: 0, y: 0 },
        width: 2,
        height: 2,
        layer: "z0",
        availableZ: [0],
      },
      {
        capacityMeshNodeId: "east",
        center: { x: 2.0005, y: 0 },
        width: 2,
        height: 2,
        layer: "z0",
        availableZ: [0],
      },
    ]
    if (hasContinuousPath) {
      nodes.push({
        capacityMeshNodeId: "continuous",
        center: { x: 1.00025, y: 2 },
        width: 4.0005,
        height: 2,
        layer: "z0",
        availableZ: [0],
      })
    }
    const edges = new CapacityMeshEdgeSolver2_NodeTreeOptimization(nodes)
    edges.solve()
    const ports = new AvailableSegmentPointSolver({
      nodes,
      edges: edges.edges,
      traceWidth: 0.1,
      shouldReturnCrampedPortPoints: true,
    })
    ports.solve()
    const connectivityMap = new ConnectivityMap({})
    connectivityMap.addConnections([["signal", "net"]])
    const { graph, connections } = buildHyperGraph({
      capacityMeshNodes: nodes,
      segmentPortPoints: ports.getOutput().flatMap((edge) => edge.portPoints),
      layerCount: 1,
      connectivityMap,
      simpleRouteJsonConnections: [
        {
          name: "signal",
          pointsToConnect: [
            { x: 0, y: 0, layer: "top" },
            { x: 2.0005, y: 0, layer: "top" },
          ],
        },
      ],
    })
    const solver = new TinyHypergraphPortPointPathingSolver({
      graph,
      connections,
      layerCount: 1,
      effort: 1,
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
    expect(solver.error).toBeNull()
    expect(solver.solved).toBe(true)
    const routedNodes = solver.getOutput().nodesWithPortPoints
    expect(
      routedNodes.some((node) => node.capacityMeshNodeId === "continuous"),
    ).toBe(hasContinuousPath)
    expect(routedNodes.some((node) => node.capacityMeshNodeId === "west")).toBe(
      true,
    )
    expect(routedNodes.some((node) => node.capacityMeshNodeId === "east")).toBe(
      true,
    )
  }
})
