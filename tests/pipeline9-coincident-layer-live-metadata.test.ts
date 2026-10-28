import { expect, test } from "bun:test"
import { coalescePipeline9LayerRegions } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/coalescePipeline9LayerRegions"
import type { CapacityMeshNode } from "lib/types"

test("live undefined topology fields are nonsemantic while unsupported metadata remains untouched", () => {
  const nodes: CapacityMeshNode[] = [1, 2].map((z) => ({ capacityMeshNodeId: `inner${z}`,
    center: { x: 0, y: 0 }, width: 1, height: 1, availableZ: [z], layer: `z${z}`,
    _isComponentTopologyNode: true, _adjacentNodeIds: undefined, _parent: undefined,
    _strawNode: undefined, _strawParentCapacityMeshNodeId: undefined,
    _offBoardConnectionId: undefined, _offBoardConnectedCapacityMeshNodeIds: undefined }))
  const input = { layerCount: 4, terminalConnections: [] }
  expect(coalescePipeline9LayerRegions({ nodes, ...input }).removedNodeCount).toBe(1)
  const unsupported = nodes.map((node) => Object.assign({ ...node }, { unknownRoutingSemantic: true }))
  expect(coalescePipeline9LayerRegions({ nodes: unsupported, ...input }).nodes).toEqual(unsupported)
  expect(coalescePipeline9LayerRegions({ nodes: unsupported, ...input }).removedNodeCount).toBe(0)
  const overflowed = { ...nodes[0]!, center: { x: Number.MAX_VALUE, y: 0 }, width: Number.MAX_VALUE }
  expect(() => coalescePipeline9LayerRegions({ nodes: [overflowed], ...input })).toThrow("Invalid capacity region")
  const collapsed = { ...nodes[0]!, center: { x: 1e100, y: 0 }, width: 1 }
  expect(() => coalescePipeline9LayerRegions({ nodes: [collapsed], ...input })).toThrow("Invalid capacity region")
})
