import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import type { CapacityMeshNode, CapacityMeshNodeId } from "lib/types"
import { getSharedEdgeForNodePair } from "../../UniformPortDistributionSolver/getSharedEdgeForNodePair"
import { getSharedEdgeRoutingIntervals } from "../../UniformPortDistributionSolver/getSharedEdgeRoutingIntervals"
import type {
  BoundaryRoutingGeometry,
  Bounds,
} from "../../UniformPortDistributionSolver/types"

type BoundaryLayerKey = string

/** Prevents synthetic capacity from exceeding the copper-clear boundary length. */
export function limitDuplicatePortsToRoutingCapacity({
  graph,
  nodes,
  routingGeometry,
}: {
  graph: SerializedHyperGraph
  nodes: CapacityMeshNode[]
  routingGeometry: BoundaryRoutingGeometry
}): SerializedHyperGraph {
  const minTraceCenterSpacing =
    routingGeometry.traceWidth + routingGeometry.traceClearance
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
  const counts = new Map<BoundaryLayerKey, number>()
  const capacities = new Map<BoundaryLayerKey, number>()
  const nodeById = new Map<CapacityMeshNodeId, CapacityMeshNode>(
    nodes.map((node) => [node.capacityMeshNodeId, node]),
  )
  for (const port of graph.ports) {
    if (typeof port.d?.duplicatedFromPortId === "string") continue
    const owners = [port.region1Id, port.region2Id].sort()
    const key: BoundaryLayerKey = `${owners.join("|")}:${port.d?.z}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const ports = graph.ports.filter((port) => {
    if (typeof port.d?.duplicatedFromPortId !== "string") return true
    // Target regions already restrict every route to their owning net.
    if (
      nodeById.get(port.region1Id)?._containsTarget ||
      nodeById.get(port.region2Id)?._containsTarget
    )
      return true
    const sharedEdge = getSharedEdgeForNodePair({
      nodeAId: port.region1Id,
      nodeBId: port.region2Id,
      nodeBounds,
    })
    if (!sharedEdge) return true
    const z = port.d?.z
    if (typeof z !== "number")
      throw new Error(`Duplicate port "${port.portId}" has no layer`)
    const key: BoundaryLayerKey = `${sharedEdge.ownerPairKey}:${z}`
    let capacity = capacities.get(key)
    if (capacity === undefined) {
      const intervals = getSharedEdgeRoutingIntervals({
        sharedEdge,
        z,
        routingGeometry,
      })
      capacity = intervals.reduce(
        (sum, interval) =>
          sum +
          Math.floor(
            (interval.max - interval.min + 1e-6) / minTraceCenterSpacing,
          ) +
          1,
        0,
      )
      capacities.set(key, capacity)
    }
    const count = counts.get(key)
    if (count === undefined)
      throw new Error(
        `Duplicate port "${port.portId}" has no original boundary`,
      )
    if (count >= capacity) return false
    counts.set(key, count + 1)
    return true
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
