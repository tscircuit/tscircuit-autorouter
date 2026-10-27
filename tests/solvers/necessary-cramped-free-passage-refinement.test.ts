import { expect, test } from "bun:test"
import { TinyHyperGraphSolver } from "tiny-hypergraph/lib/core"
import { loadSerializedHyperGraph } from "tiny-hypergraph/lib/compat/loadSerializedHyperGraph"
import { CapacityMeshEdgeSolver2_NodeTreeOptimization } from "../../lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver2_NodeTreeOptimization"
import { AvailableSegmentPointSolver } from "../../lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { MultiTargetNecessaryCrampedPortPointSolver } from "../../lib/solvers/NecessaryCrampedPortPointSolver/MultiTargetNecessaryCrampedPortPointSolver"
import type { CapacityMeshNode, SimpleRouteJson } from "../../lib/types"

test("subdividing the same free passage preserves connectivity between the same declared targets", () => {
  // The obstacle and free-space union is identical in every case. The upper
  // free cell gives the left target an ordinary escape, so the target-local
  // heuristic cannot establish that the other shared face is unnecessary.
  for (const strips of [1, 2, 5, 10]) {
    const nodes: CapacityMeshNode[] = [
      { capacityMeshNodeId: "left", center: { x: -0.5, y: 0 }, width: 1, height: 1, availableZ: [0] },
      { capacityMeshNodeId: "upper-escape", center: { x: -0.5, y: 1 }, width: 1, height: 1, availableZ: [0] },
      { capacityMeshNodeId: "target-left", center: { x: -1.25, y: 0 }, width: 0.5, height: 1, availableZ: [0], _containsObstacle: true, _containsTarget: true },
      { capacityMeshNodeId: "target-right", center: { x: 1.25, y: 0 }, width: 0.5, height: 1, availableZ: [0], _containsObstacle: true, _containsTarget: true },
    ]
    for (let i = 0; i < strips; i++) {
      nodes.push({ capacityMeshNodeId: `right-${i}`, center: { x: 0.5, y: -0.5 + (i + 0.5) / strips }, width: 1, height: 1 / strips, availableZ: [0] })
    }
    const srj = {
      layerCount: 8, minTraceWidth: 0.1, obstacles: [],
      bounds: { minX: -1.5, maxX: 1.5, minY: -0.5, maxY: 1.5 },
      connections: [{ name: "net", pointsToConnect: [{ x: -1.25, y: 0, layer: "top" }, { x: 1.25, y: 0, layer: "top" }] }],
    } as SimpleRouteJson
    const originalNodes = structuredClone(nodes)
    const edges = new CapacityMeshEdgeSolver2_NodeTreeOptimization(nodes)
    edges.solve()
    const available = new AvailableSegmentPointSolver({ nodes, edges: edges.edges, traceWidth: 0.1, obstacleMargin: 0.15, shouldReturnCrampedPortPoints: true })
    available.solve()
    const originalSegments = structuredClone(available.getOutput())
    const necessary = new MultiTargetNecessaryCrampedPortPointSolver({ capacityMeshNodes: nodes, sharedEdgeSegments: available.getOutput(), simpleRouteJson: srj })
    necessary.solve()
    const output = necessary.getOutput()
    const crossings = output.filter((segment) => segment.nodeIds.includes("left") && segment.nodeIds.some((id) => id.startsWith("right-")))
    expect(crossings).toHaveLength(strips)
    expect(crossings.every((segment) => segment.portPoints.length > 0)).toBe(true)
    for (const point of crossings.flatMap((segment) => segment.portPoints)) {
      expect(point.availableZ).toEqual([0])
      expect(point.cramped).toBe(strips >= 5)
      expect(point.tinyHypergraphPortPenalty).toBe(strips >= 5 ? 1000 : undefined)
      const source = originalSegments.flatMap((segment) => segment.portPoints).find((candidate) => candidate.segmentPortPointId === point.segmentPortPointId)!
      expect(point.x).toBe(source.x)
      expect(point.y).toBe(source.y)
    }
    const ports = output.flatMap((segment) => segment.portPoints.map((point) => ({
      portId: point.segmentPortPointId, region1Id: point.nodeIds[0], region2Id: point.nodeIds[1],
      d: { ...point, z: point.availableZ[0] },
    })))
    const graph = {
      regions: nodes.map((node) => ({ regionId: node.capacityMeshNodeId, d: node,
        pointIds: ports.filter((port) => port.region1Id === node.capacityMeshNodeId || port.region2Id === node.capacityMeshNodeId).map((port) => port.portId) })),
      ports, connections: [{ connectionId: "net", mutuallyConnectedNetworkId: "net", startRegionId: "target-left", endRegionId: "target-right" }],
    }
    const { topology, problem } = loadSerializedHyperGraph(graph)
    const tiny = new TinyHyperGraphSolver(topology, problem, { MAX_ITERATIONS: 1000, GREEDY_FINAL_ROUTE_ITERS: 0, RIP_THRESHOLD_RAMP_ATTEMPTS: 0 })
    tiny.solve()
    expect(tiny.solved).toBe(true)
    expect(tiny.failed).toBe(false)
    expect(tiny.state.unroutedRoutes).toEqual([])
    expect(nodes).toEqual(originalNodes)
    expect(available.getOutput()).toEqual(originalSegments)
    expect(necessary.getOutput()).toBe(output)
  }
})
