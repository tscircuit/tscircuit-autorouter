import { expect, test } from "bun:test"
import { coalescePipeline9LayerRegions } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/coalescePipeline9LayerRegions"
import type { CapacityMeshNode } from "lib/types"

test("references from other capacity nodes keep every referenced region ID intact", () => {
  const originals: CapacityMeshNode[] = [1, 2].map((z) => ({ capacityMeshNodeId: `inner${z}`,
    center: { x: 0, y: 0 }, width: 1, height: 1, availableZ: [z], layer: `z${z}`,
    _isComponentTopologyNode: true }))
  for (const reference of [{ _adjacentNodeIds: ["inner2"] },
    { _offBoardConnectedCapacityMeshNodeIds: ["inner2"] },
    { _strawParentCapacityMeshNodeId: "inner2" }, { _parent: originals[1] }]) {
    const referrer: CapacityMeshNode = { capacityMeshNodeId: "referrer", center: { x: 3, y: 0 },
      width: 1, height: 1, layer: "z1", availableZ: [1], ...reference }
    const nodes = [...originals, referrer]
    const result = coalescePipeline9LayerRegions({ nodes, layerCount: 4, terminalConnections: [] })
    expect(result.removedNodeCount).toBe(0)
    expect(result.nodes).toEqual(nodes)
    expect(result.nodes.find((node) => node.capacityMeshNodeId === "inner2")).toBe(originals[1])
  }
})
