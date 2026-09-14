import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import type { CapacityMeshNode, CapacityMeshNodeId } from "lib/types"
import { getSharedEdgeForNodePair } from "../../UniformPortDistributionSolver/getSharedEdgeForNodePair"
import { getSharedEdgeRoutingIntervals } from "../../UniformPortDistributionSolver/getSharedEdgeRoutingIntervals"
import { getSpacedPositionsInIntervals } from "../../UniformPortDistributionSolver/getSpacedPositionsInIntervals"
import type {
  BoundaryRoutingGeometry,
  Bounds,
} from "../../UniformPortDistributionSolver/types"

type BoundaryLayerKey = string
type SerializedPortId = SerializedHyperGraph["ports"][number]["portId"]

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
      capacity = 0
      let nextPosition = Number.NEGATIVE_INFINITY
      for (const interval of intervals) {
        const firstPosition = Math.max(interval.min, nextPosition)
        if (firstPosition > interval.max + 1e-6) continue
        const intervalCount =
          Math.floor(
            (interval.max - firstPosition + 1e-6) / minTraceCenterSpacing,
          ) + 1
        capacity += intervalCount
        nextPosition = firstPosition + intervalCount * minTraceCenterSpacing
      }
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
  const families = new Map<BoundaryLayerKey, typeof ports>()
  for (const port of ports) {
    const owners = [port.region1Id, port.region2Id].sort()
    const key: BoundaryLayerKey = `${owners.join("|")}:${port.d?.z}`
    const family = families.get(key) ?? []
    family.push(port)
    families.set(key, family)
  }
  const positionsByPortId = new Map<
    SerializedPortId,
    { x: number; y: number }
  >()
  for (const [key, family] of families) {
    if (
      !family.some(
        (port) => typeof port.d?.duplicatedFromPortId === "string",
      ) ||
      family.some(
        (port) =>
          Array.isArray(port.d?._preloadedFixedNetIds) &&
          port.d._preloadedFixedNetIds.length > 0,
      )
    )
      continue
    const firstPort = family[0]!
    if (
      nodeById.get(firstPort.region1Id)?._containsTarget ||
      nodeById.get(firstPort.region2Id)?._containsTarget
    )
      continue
    const sharedEdge = getSharedEdgeForNodePair({
      nodeAId: firstPort.region1Id,
      nodeBId: firstPort.region2Id,
      nodeBounds,
    })
    if (!sharedEdge) continue
    const z = firstPort.d?.z
    if (typeof z !== "number")
      throw new Error(`Boundary "${key}" has no routing layer`)
    const horizontal = sharedEdge.orientation === "horizontal"
    const coordinate = horizontal ? "x" : "y"
    family.sort((left, right) => {
      const a = left.d?.[coordinate]
      const b = right.d?.[coordinate]
      if (typeof a !== "number" || typeof b !== "number")
        throw new Error(`Boundary "${key}" has a port without coordinates`)
      return a - b
    })
    const edgeMin = horizontal ? sharedEdge.x1 : sharedEdge.y1
    const preferredSpacing = Math.max(
      sharedEdge.length / family.length,
      minTraceCenterSpacing,
    )
    const firstOffset =
      (sharedEdge.length - preferredSpacing * (family.length - 1)) / 2
    const positions = getSpacedPositionsInIntervals({
      intervals: getSharedEdgeRoutingIntervals({
        sharedEdge,
        z,
        routingGeometry,
      }),
      preferredPositions: family.map(
        (_, index) => edgeMin + firstOffset + preferredSpacing * index,
      ),
      spacing: minTraceCenterSpacing,
      boundaryLabel: key,
    })
    // The path search must see the same physical ordering and separation that
    // high-density routing will receive, rather than the provisional offsets.
    for (const [index, port] of family.entries()) {
      positionsByPortId.set(port.portId, {
        x: horizontal ? positions[index]! : sharedEdge.x1,
        y: horizontal ? sharedEdge.y1 : positions[index]!,
      })
    }
  }
  return {
    ...graph,
    ports: ports.map((port) => {
      const position = positionsByPortId.get(port.portId)
      return position
        ? {
            ...port,
            d: {
              ...port.d,
              ...position,
              boundaryTraceSpacing: minTraceCenterSpacing,
            },
          }
        : port
    }),
    regions: graph.regions.map((region) => ({
      ...region,
      pointIds: region.pointIds.filter((portId) => retainedPortIds.has(portId)),
    })),
  }
}
