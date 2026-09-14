import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import type { CapacityMeshNode, CapacityMeshNodeId } from "lib/types"
import { getSharedEdgeForNodePair } from "../../UniformPortDistributionSolver/getSharedEdgeForNodePair"
import type { Bounds } from "../../UniformPortDistributionSolver/types"

type SerializedPort = SerializedHyperGraph["ports"][number]
type SerializedPortId = SerializedPort["portId"]
type BoundaryLayerKey = string

/** Adds only physically spaced boundary choices; original terminals stay fixed. */
export function constrainDuplicatePortsToSharedEdges({
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
  const originalPortById = new Map<SerializedPortId, SerializedPort>(
    originalPorts.map((port) => [port.portId, port]),
  )
  const originalPortsByBoundary = new Map<BoundaryLayerKey, SerializedPort[]>()
  for (const port of originalPorts) {
    const owners = [port.region1Id, port.region2Id].sort()
    const key: BoundaryLayerKey = `${owners[0]}|${owners[1]}:${port.d?.z}`
    const boundaryPorts = originalPortsByBoundary.get(key)
    if (boundaryPorts) boundaryPorts.push(port)
    else originalPortsByBoundary.set(key, [port])
  }
  const occupiedCoordinates = new Map<BoundaryLayerKey, number[]>()
  const retainedPorts = [...originalPorts]

  for (const port of graph.ports) {
    const sourcePortId = port.d?.duplicatedFromPortId
    if (typeof sourcePortId !== "string") continue
    const sourcePort = originalPortById.get(sourcePortId)
    if (!sourcePort) {
      throw new Error(`Duplicate port "${port.portId}" has no source port`)
    }
    const sharedEdge = getSharedEdgeForNodePair({
      nodeAId: sourcePort.region1Id,
      nodeBId: sourcePort.region2Id,
      nodeBounds,
    })
    // Virtual terminal regions and point contacts have no extra boundary slots.
    if (!sharedEdge) continue
    const axis = sharedEdge.orientation === "horizontal" ? "x" : "y"
    const z = sourcePort.d?.z
    const sourceCoordinate = sourcePort.d?.[axis]
    if (typeof z !== "number" || typeof sourceCoordinate !== "number") {
      throw new Error(`Source port "${sourcePortId}" has invalid coordinates`)
    }
    const key: BoundaryLayerKey = `${sharedEdge.ownerPairKey}:${z}`
    let occupied = occupiedCoordinates.get(key)
    if (!occupied) {
      const boundaryPorts = originalPortsByBoundary.get(key)
      if (!boundaryPorts)
        throw new Error(`Missing original boundary ports for "${sourcePortId}"`)
      occupied = boundaryPorts.map((original): number => {
        const coordinate = original.d?.[axis]
        if (typeof coordinate !== "number" || !Number.isFinite(coordinate)) {
          throw new Error(`Port "${original.portId}" has invalid coordinates`)
        }
        return coordinate
      })
      occupiedCoordinates.set(key, occupied)
    }
    occupied.sort((a, b) => a - b)
    const edgeStart = axis === "x" ? sharedEdge.x1 : sharedEdge.y1
    const edgeEnd = axis === "x" ? sharedEdge.x2 : sharedEdge.y2
    // Reserve room at corners as well as between distinct routing choices.
    let lower = edgeStart + minPortSpacing
    const upper = edgeEnd - minPortSpacing
    let selectedCoordinate: number | undefined
    let nearestDistance = Number.POSITIVE_INFINITY
    for (const next of [...occupied, edgeEnd]) {
      const gapEnd = Math.min(upper, next - minPortSpacing)
      if (lower <= gapEnd) {
        const coordinate = Math.max(lower, Math.min(gapEnd, sourceCoordinate))
        const distance = Math.abs(coordinate - sourceCoordinate)
        if (distance < nearestDistance) {
          selectedCoordinate = coordinate
          nearestDistance = distance
        }
      }
      lower = Math.max(lower, next + minPortSpacing)
    }
    if (selectedCoordinate === undefined) continue
    occupied.push(selectedCoordinate)
    retainedPorts.push({
      ...port,
      d: {
        ...port.d,
        x: axis === "x" ? selectedCoordinate : sharedEdge.x1,
        y: axis === "y" ? selectedCoordinate : sharedEdge.y1,
      },
    })
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
