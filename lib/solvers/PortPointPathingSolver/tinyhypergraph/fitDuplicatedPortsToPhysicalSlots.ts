import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { getSharedEdgeForNodePair } from "lib/solvers/UniformPortDistributionSolver/getSharedEdgeForNodePair"
import type { Bounds } from "lib/solvers/UniformPortDistributionSolver/types"

type SerializedPort = SerializedHyperGraph["ports"][number]

/**
 * Congestion estimates may request extra slots, but do not create physical
 * capacity. Keep existing ports fixed and place duplicates only in unused,
 * copper-width-spaced positions on the actual shared boundary (board mm).
 */
export const fitDuplicatedPortsToPhysicalSlots = (
  graph: SerializedHyperGraph,
  minPortSpacing: number,
): SerializedHyperGraph => {
  if (!Number.isFinite(minPortSpacing) || minPortSpacing <= 0) {
    throw new Error("Physical port spacing must be finite and positive")
  }
  const boundsByRegionId = new Map<string, Bounds>()
  const regionById = new Map(graph.regions.map((region) => [region.regionId, region]))
  for (const region of graph.regions) {
    const { center, width, height } = region.d
    boundsByRegionId.set(region.regionId, {
      minX: center.x - width / 2,
      maxX: center.x + width / 2,
      minY: center.y - height / 2,
      maxY: center.y + height / 2,
    })
  }
  const portsByBoundaryAndLayer = new Map<string, SerializedPort[]>()
  for (const port of graph.ports) {
    const key = `${[port.region1Id, port.region2Id].sort().join("\0")}\0${port.d.z}`
    const ports = portsByBoundaryAndLayer.get(key) ?? []
    ports.push(port)
    portsByBoundaryAndLayer.set(key, ports)
  }
  const keptPorts = new Map<string, SerializedPort>()
  for (const ports of portsByBoundaryAndLayer.values()) {
    const originals = ports.filter((port) => !port.d.duplicatedFromPortId)
    const duplicates = ports.filter((port) => port.d.duplicatedFromPortId)
    for (const port of originals) keptPorts.set(port.portId, port)
    if (duplicates.length === 0) continue
    const first = ports[0]!
    const edge = getSharedEdgeForNodePair({
      nodeAId: first.region1Id,
      nodeBId: first.region2Id,
      nodeBounds: boundsByRegionId,
    })
    // Synthetic terminal/via interfaces are not extra shared-edge capacity.
    if (!edge) continue
    if ([first.region1Id, first.region2Id].some((id) => {
      const region = regionById.get(id)!
      return region.d._containsTarget || region.d._containsObstacle
    })) continue
    const edgeMargin = minPortSpacing * 3 / 4
    const effectiveLength = edge.length - edgeMargin * 2
    if (effectiveLength < 0) continue
    const slotCount = Math.floor(effectiveLength / minPortSpacing) + 1
    const occupied = originals.map((port) => ({ x: port.d.x, y: port.d.y }))
    let duplicateIndex = 0
    for (let index = 0; index < slotCount && duplicateIndex < duplicates.length; index++) {
      const distance = slotCount === 1 ? edge.length / 2 : edgeMargin + effectiveLength * index / (slotCount - 1)
      const point = {
        x: edge.orientation === "horizontal" ? edge.x1 + distance : edge.x1,
        y: edge.orientation === "vertical" ? edge.y1 + distance : edge.y1,
      }
      if (occupied.some((other) => Math.hypot(point.x - other.x, point.y - other.y) < minPortSpacing - 1e-6)) continue
      const duplicate = duplicates[duplicateIndex++]!
      keptPorts.set(duplicate.portId, { ...duplicate, d: { ...duplicate.d, ...point } })
      occupied.push(point)
    }
  }
  return {
    ...graph,
    ports: graph.ports.flatMap((port) => {
      const kept = keptPorts.get(port.portId)
      return kept ? [kept] : []
    }),
    regions: graph.regions.map((region) => ({
      ...region,
      pointIds: region.pointIds.filter((id) => keptPorts.has(id)),
    })),
  }
}
