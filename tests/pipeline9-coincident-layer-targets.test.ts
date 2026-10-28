import { expect, test } from "bun:test"
import { coalescePipeline9LayerRegions } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/coalescePipeline9LayerRegions"
import type { CapacityMeshNode } from "lib/types"

test("original layered endpoints and owned regions remain separate before target metadata exists", () => {
  const cell = (id: string, x: number, z: number, metadata: Partial<CapacityMeshNode> = {}): CapacityMeshNode => ({
    capacityMeshNodeId: id, center: { x, y: 0 }, width: 1, height: 1, availableZ: [z],
    layer: `z${z}`, _isComponentTopologyNode: true, ...metadata,
  })
  const nodes = [cell("endpoint1", 0, 1), cell("endpoint2", 0, 2),
    cell("owned1", 2, 1, { _connectedTo: ["owner"] }), cell("owned2", 2, 2, { _connectedTo: ["owner"] }),
    cell("target1", 4, 1, { _containsTarget: true }), cell("target2", 4, 2, { _containsTarget: true }),
    cell("pad1", 6, 1, { _containsObstacle: true }), cell("pad2", 6, 2, { _containsObstacle: true }),
    cell("near1", 8, 1), cell("near2", 8, 2), cell("other-layer1", 10, 1), cell("other-layer2", 10, 2)]
  const result = coalescePipeline9LayerRegions({ nodes, layerCount: 4, terminalConnections: [
    { name: "via-terminal", pointsToConnect: [{ x: 0, y: 0, layers: ["inner1", "inner2"] }] },
    { name: "boundary-terminal", pointsToConnect: [{ x: 8.5005, y: 0, layer: "inner1" }] },
    { name: "unrelated-layer", pointsToConnect: [{ x: 10, y: 0, layer: "bottom" }] },
  ] })
  expect(result.removedNodeCount).toBe(1)
  expect(result.groups[0]!.keptNodeId).toBe("other-layer1")
  expect(result.nodes.filter((node) => node.capacityMeshNodeId.startsWith("endpoint"))).toHaveLength(2)
  expect(result.nodes.filter((node) => node.capacityMeshNodeId.startsWith("near"))).toHaveLength(2)
  expect(result.nodes.filter((node) => node._containsObstacle)).toHaveLength(2)
  expect(result.nodes.filter((node) => node._containsTarget)).toHaveLength(2)
  expect(result.nodes.filter((node) => node._connectedTo?.includes("owner"))).toHaveLength(2)
})
