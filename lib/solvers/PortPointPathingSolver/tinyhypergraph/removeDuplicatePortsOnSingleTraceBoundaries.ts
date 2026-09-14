import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import type { CapacityMeshNode, CapacityMeshNodeId } from "lib/types"
import { getSharedEdgeForNodePair } from "../../UniformPortDistributionSolver/getSharedEdgeForNodePair"
import type { Bounds } from "../../UniformPortDistributionSolver/types"

/** Prevents synthetic ports from admitting multiple nets through a one-trace gap. */
export function removeDuplicatePortsOnSingleTraceBoundaries({
  graph,
  nodes,
  minTraceCenterSpacing,
}: {
  graph: SerializedHyperGraph
  nodes: CapacityMeshNode[]
  minTraceCenterSpacing: number
}): SerializedHyperGraph {
  if (!Number.isFinite(minTraceCenterSpacing) || minTraceCenterSpacing <= 0) {
    throw new Error("Trace center spacing must be positive and finite")
  }
  const nodeBounds = new Map<CapacityMeshNodeId, Bounds>(
    nodes.map((node) => [
      node.capacityMeshNodeId,
      {
        minX: node.center.x - node.width / 2,
        maxX: node.center.x + node.width / 2,
        minY: node.center.y - node.height / 2,
        maxY: node.center.y + node.height / 2,
      },
    ]),
  )
  const ports = graph.ports.filter((port) => {
    if (typeof port.d?.duplicatedFromPortId !== "string") return true
    const sharedEdge = getSharedEdgeForNodePair({
      nodeAId: port.region1Id,
      nodeBId: port.region2Id,
      nodeBounds,
    })
    // Original ports are alternatives, not occupied copper. Only remove clones
    // where even two trace centers cannot fit anywhere on the shared edge.
    return !sharedEdge || sharedEdge.length + 1e-6 >= minTraceCenterSpacing
  })
  const retainedPortIds = new Set(ports.map((port) => port.portId))
  return {
    ...graph,
    ports,
    regions: graph.regions.map((region) => ({
      ...region,
      pointIds: region.pointIds.filter((portId) => retainedPortIds.has(portId)),
    })),
  }
}
