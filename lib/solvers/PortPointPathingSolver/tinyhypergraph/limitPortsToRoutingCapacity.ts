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

/** Limits every movable boundary port to physically routable copper clearance. */
export function limitPortsToRoutingCapacity({
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
  const nodeById = new Map<CapacityMeshNodeId, CapacityMeshNode>(
    nodes.map((node) => [node.capacityMeshNodeId, node]),
  )
  const families = new Map<BoundaryLayerKey, typeof graph.ports>()
  for (const port of graph.ports) {
    const owners = [port.region1Id, port.region2Id].sort()
    const key: BoundaryLayerKey = `${owners.join("|")}:${port.d?.z}`
    const family = families.get(key) ?? []
    family.push(port)
    families.set(key, family)
  }
  const retainedPortIds = new Set(graph.ports.map((port) => port.portId))
  const positionsByPortId = new Map<
    SerializedPortId,
    { x: number; y: number }
  >()
  for (const [key, family] of families) {
    const firstPort = family[0]!
    // Target regions already restrict every route to their owning net.
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
    const intervals = getSharedEdgeRoutingIntervals({
      sharedEdge,
      z,
      routingGeometry,
    })
    let capacity = 0
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
    const hasFixedCopper = family.some(
      (port) =>
        Array.isArray(port.d?._preloadedFixedNetIds) &&
        port.d._preloadedFixedNetIds.length > 0,
    )
    const originals = family.filter(
      (port) => typeof port.d?.duplicatedFromPortId !== "string",
    )
    const duplicates = family.filter(
      (port) => typeof port.d?.duplicatedFromPortId === "string",
    )
    const horizontal = sharedEdge.orientation === "horizontal"
    const edgeMin = horizontal ? sharedEdge.x1 : sharedEdge.y1
    const edgeMax = horizontal ? sharedEdge.x2 : sharedEdge.y2
    const hasCopperRestriction =
      intervals.length !== 1 ||
      intervals[0]!.min > edgeMin ||
      intervals[0]!.max < edgeMax
    if (
      duplicates.length === 0 &&
      !hasCopperRestriction &&
      capacity >= family.length
    )
      continue
    // Existing preloaded copper stays fixed. Only its synthetic spare capacity
    // can be removed; ordinary boundaries must also constrain original ports.
    const retained = [...originals, ...duplicates].slice(
      0,
      hasFixedCopper ? Math.max(originals.length, capacity) : capacity,
    )
    const retainedFamilyIds = new Set(retained.map((port) => port.portId))
    for (const port of family) {
      if (!retainedFamilyIds.has(port.portId))
        retainedPortIds.delete(port.portId)
    }
    if (hasFixedCopper || retained.length === 0) continue
    const coordinate = horizontal ? "x" : "y"
    retained.sort((left, right) => {
      const a = left.d?.[coordinate]
      const b = right.d?.[coordinate]
      if (typeof a !== "number" || typeof b !== "number")
        throw new Error(`Boundary "${key}" has a port without coordinates`)
      return a - b
    })
    const preferredSpacing = Math.max(
      sharedEdge.length / retained.length,
      minTraceCenterSpacing,
    )
    const firstOffset =
      (sharedEdge.length - preferredSpacing * (retained.length - 1)) / 2
    const positions = getSpacedPositionsInIntervals({
      intervals,
      preferredPositions: retained.map((port, index) => {
        if (duplicates.length > 0)
          return edgeMin + firstOffset + preferredSpacing * index
        const position = port.d?.[coordinate]
        if (typeof position !== "number")
          throw new Error(`Boundary "${key}" has a port without coordinates`)
        return position
      }),
      spacing: minTraceCenterSpacing,
      boundaryLabel: key,
    })
    // The path search must see the same physical ordering and separation that
    // high-density routing will receive, rather than the provisional offsets.
    for (const [index, port] of retained.entries()) {
      positionsByPortId.set(port.portId, {
        x: horizontal ? positions[index]! : sharedEdge.x1,
        y: horizontal ? sharedEdge.y1 : positions[index]!,
      })
    }
  }
  return {
    ...graph,
    ports: graph.ports
      .filter((port) => retainedPortIds.has(port.portId))
      .map((port) => {
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
