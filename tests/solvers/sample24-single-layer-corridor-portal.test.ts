import { expect, test } from "bun:test"
import { TinyHyperGraphSolver } from "tiny-hypergraph/lib/core"
import { loadSerializedHyperGraph } from "tiny-hypergraph/lib/compat/loadSerializedHyperGraph"
import { CapacityMeshEdgeSolver2_NodeTreeOptimization } from "../../lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver2_NodeTreeOptimization"
import { AvailableSegmentPointSolver } from "../../lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { MultiTargetNecessaryCrampedPortPointSolver } from "../../lib/solvers/NecessaryCrampedPortPointSolver/MultiTargetNecessaryCrampedPortPointSolver"
import type { CapacityMeshNode, SimpleRouteJson } from "../../lib/types"
import fixture from "../fixtures/sample24/route1632-portal.json"

test("sample24 retains a bottom corridor across artificial shared-face subdivisions", () => {
  const nodes = structuredClone(fixture.nodes) as CapacityMeshNode[]
  const originalNodes = JSON.stringify(nodes)
  const edges = new CapacityMeshEdgeSolver2_NodeTreeOptimization(nodes)
  edges.solve()
  const available = new AvailableSegmentPointSolver({
    nodes, edges: edges.edges, traceWidth: 0.1,
    shouldReturnCrampedPortPoints: true,
  })
  available.solve()
  const necessary = new MultiTargetNecessaryCrampedPortPointSolver({
    capacityMeshNodes: nodes, sharedEdgeSegments: available.getOutput(),
    simpleRouteJson: {
      layerCount: 8, minTraceWidth: 0.1, obstacles: [],
      bounds: { minX: 140, maxX: 155, minY: 100, maxY: 115 },
      connections: [fixture.connection.simpleRouteConnection],
    } as SimpleRouteJson,
  })
  necessary.solve()
  const west = "new-cmn_4740-6775"
  const east = ["new-new-cmn_372-3868-709__sub_0_0", "new-new-cmn_372-3868-709__sub_1_0"]
  const corridor = new Set(["cmn_4740", west, ...east, "cmn_4982"])
  const ports = necessary.getOutput().flatMap((segment) =>
    segment.nodeIds.every((id) => corridor.has(id))
      ? segment.portPoints.map((point) => ({
          portId: point.segmentPortPointId,
          region1Id: point.nodeIds[0], region2Id: point.nodeIds[1],
          d: { x: point.x, y: point.y, z: point.availableZ[0], cramped: point.cramped },
        })) : [],
  )
  const regions = nodes.filter((node) => corridor.has(node.capacityMeshNodeId))
    .map((node) => ({ regionId: node.capacityMeshNodeId, d: node,
      pointIds: ports.filter((port) => [port.region1Id, port.region2Id].includes(node.capacityMeshNodeId)).map((port) => port.portId) }))
  const graph = {
    regions: [...regions, ...fixture.terminalRegions],
    ports: [...ports, ...fixture.terminalPorts], connections: [fixture.connection],
  }
  const { topology, problem } = loadSerializedHyperGraph(graph)
  // This isolated fixture retains the full board's authoritative owner153.
  problem.routeNet[0] = 153
  const tiny = new TinyHyperGraphSolver(topology, problem, {
    MAX_ITERATIONS: 1000,
  })
  tiny.solve()
  expect(tiny.solved).toBe(true)
  expect(tiny.failed).toBe(false)
  const used = tiny.state.regionSegments.flatMap((segments, region) =>
    segments.length ? [topology.regionMetadata[region].capacityMeshNodeId] : [],
  )
  expect(used).toContain(west)
  expect(east.some((id) => used.includes(id))).toBe(true)
  const corridorSegments = necessary.getOutput().filter((segment) =>
    segment.nodeIds.includes(west) && east.some((id) => segment.nodeIds.includes(id)))
  expect(corridorSegments).toHaveLength(2)
  for (const segment of corridorSegments) {
    expect(segment.portPoints).toHaveLength(1)
    expect(segment.portPoints[0].cramped).toBe(false)
    expect(segment.portPoints[0].availableZ).toEqual([7])
    expect(segment.portPoints[0].y).toBeCloseTo((segment.start.y + segment.end.y) / 2, 12)
  }
  expect(JSON.stringify(nodes)).toBe(originalNodes)
})
