import { expect, test } from "bun:test"
import { coalescePipeline9LayerRegions } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/coalescePipeline9LayerRegions"
import type { CapacityMeshNode } from "lib/types"

test("coalescence declines incompatible, nonidentical, occupied and overlapping layer cells", () => {
  const node = (id: string, x: number, z: number, metadata: Partial<CapacityMeshNode> = {}): CapacityMeshNode => ({
    capacityMeshNodeId: id, center: { x, y: 0 }, width: 1, height: 1,
    layer: `z${z}`, availableZ: [z], _isComponentTopologyNode: true, ...metadata,
  })
  const nodes = [node("shape1", 0, 1), node("shape2", 0, 2, { width: 1 + 1e-12 }),
    node("metadata1", 2, 1, { _isNarrowQfpPadGap: true }), node("metadata2", 2, 2),
    node("overlap1", 4, 1), node("overlap2", 4, 1),
    node("blocked1", 6, 1), node("blocked2", 6, 2),
    node("foreign-cell", 6.1, 1, { _isComponentTopologyNode: false }),
    node("permission1", 8, 1, { layerChangeAllowedNetIds: [] }),
    node("permission2", 8, 2, { layerChangeAllowedNetIds: ["owner"] }),
    node("passthrough1", 10, 1, { _isComponentTopologyNode: false }),
    node("passthrough2", 10, 2, { _isComponentTopologyNode: false })]
  const terminalInput = { layerCount: 4, terminalConnections: [] }
  const result = coalescePipeline9LayerRegions({ nodes, ...terminalInput })
  expect(result.nodes).toEqual(nodes)
  expect(result.removedNodeCount).toBe(0)
  expect(() => coalescePipeline9LayerRegions({ nodes: [nodes[0]!, nodes[0]!], ...terminalInput })).toThrow("Duplicate capacity region")
  expect(() => coalescePipeline9LayerRegions({ nodes: [node("bad", 0, 4)], ...terminalInput })).toThrow("Invalid capacity region")
})
