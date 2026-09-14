import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import type { CapacityMeshNode, CapacityMeshNodeId } from "lib/types"
import { getSharedEdgeForNodePair } from "../../UniformPortDistributionSolver/getSharedEdgeForNodePair"
import type { Bounds } from "../../UniformPortDistributionSolver/types"

type SerializedPort = SerializedHyperGraph["ports"][number]
type BoundaryLayerKey = string

/** Limits synthetic capacity without moving original terminals or route choices. */
export function limitDuplicatePortsToBoundaryCapacity({
  graph,
  nodes,
  minPortSpacing,
}: {
  graph: SerializedHyperGraph
  nodes: CapacityMeshNode[]
  minPortSpacing: number
}): SerializedHyperGraph {
  if (!Number.isFinite(minPortSpacing) || minPortSpacing <= 0) {
    throw new Error("Duplicate port spacing must be positive and finite")
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
  const originalPorts = graph.ports.filter(
    (port) => typeof port.d?.duplicatedFromPortId !== "string",
  )
  const originalPortsByBoundary = new Map<BoundaryLayerKey, SerializedPort[]>()
  for (const port of originalPorts) {
    const owners = [port.region1Id, port.region2Id].sort()
    const key: BoundaryLayerKey = `${owners[0]}|${owners[1]}:${port.d?.z}`
    const boundaryPorts = originalPortsByBoundary.get(key)
    if (boundaryPorts) boundaryPorts.push(port)
    else originalPortsByBoundary.set(key, [port])
  }
  const retainedPorts = [...originalPorts]
  const retainedCountByBoundary = new Map<BoundaryLayerKey, number>(
    [...originalPortsByBoundary].map(([key, ports]) => [key, ports.length]),
  )
  for (const port of graph.ports) {
    if (typeof port.d?.duplicatedFromPortId !== "string") continue
    const sharedEdge = getSharedEdgeForNodePair({
      nodeAId: port.region1Id,
      nodeBId: port.region2Id,
      nodeBounds,
    })
    // Virtual terminal regions and point contacts have no extra boundary slots.
    if (!sharedEdge) continue
    const z = port.d?.z
    if (typeof z !== "number") {
      throw new Error(`Duplicate port "${port.portId}" has no layer`)
    }
    const key: BoundaryLayerKey = `${sharedEdge.ownerPairKey}:${z}`
    const count = retainedCountByBoundary.get(key)
    if (count === undefined) {
      throw new Error(
        `Duplicate port "${port.portId}" has no original boundary`,
      )
    }
    // Match the spacing and corner reserve used to generate available ports.
    const usableLength = Math.max(0, sharedEdge.length - 1.5 * minPortSpacing)
    const capacity = Math.max(1, Math.floor(usableLength / minPortSpacing) + 1)
    if (count >= capacity) continue
    retainedPorts.push(port)
    retainedCountByBoundary.set(key, count + 1)
  }
  const retainedPortIds = new Set(retainedPorts.map((port) => port.portId))
  return {
    ...graph,
    ports: retainedPorts,
    regions: graph.regions.map((region) => ({
      ...region,
      pointIds: region.pointIds.filter((portId) => retainedPortIds.has(portId)),
    })),
  }
}
