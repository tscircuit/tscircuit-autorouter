import type { AnyCircuitElement, PcbVia } from "circuit-json"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import RBush from "rbush"
import { getDrcReadableElementName } from "./drcReadableNames"

type IndexedVia = {
  minX: number
  minY: number
  maxX: number
  maxY: number
  order: number
  via: PcbVia
}

/** Checks drill spacing, and copper spacing for vias on different nets. */
export const checkViaPairClearance = (
  circuitJson: AnyCircuitElement[],
  connMap: ConnectivityMap,
  options: { viaClearance?: number } = {},
): Record<string, unknown>[] => {
  const board = circuitJson.find((element) => element.type === "pcb_board")
  const viaClearance = Math.max(options.viaClearance ?? 0.1, 0.1)
  const copperClearance = board?.min_pad_edge_to_pad_edge_clearance ?? 0.1
  const vias = circuitJson.filter((element) => element.type === "pcb_via")
  const indexedVias: IndexedVia[] = vias.map((via, order) => ({
    minX: via.x - Math.max(via.hole_diameter, via.outer_diameter) / 2,
    minY: via.y - Math.max(via.hole_diameter, via.outer_diameter) / 2,
    maxX: via.x + Math.max(via.hole_diameter, via.outer_diameter) / 2,
    maxY: via.y + Math.max(via.hole_diameter, via.outer_diameter) / 2,
    via,
    order,
  }))
  const index = new RBush<IndexedVia>()
  index.load(indexedVias)
  const sameNetErrors: Record<string, unknown>[] = []
  const differentNetErrors: Record<string, unknown>[] = []
  const reportedPairs = new Set<string>()
  const searchClearance = Math.max(viaClearance, copperClearance)
  for (const item of indexedVias) {
    const candidates = index
      .search({
        minX: item.minX - searchClearance,
        minY: item.minY - searchClearance,
        maxX: item.maxX + searchClearance,
        maxY: item.maxY + searchClearance,
      })
      .sort((left, right) => left.order - right.order)
    for (const candidate of candidates) {
      if (candidate.order <= item.order) continue
      const viaA = item.via
      const viaB = candidate.via
      const distance = Math.hypot(viaA.x - viaB.x, viaA.y - viaB.y)
      const sameNet = connMap.areIdsConnected(viaA.pcb_via_id, viaB.pcb_via_id)
      if (sameNet && distance <= 0.005) continue
      let gap = distance - viaA.hole_diameter / 2 - viaB.hole_diameter / 2
      let minimumClearance = viaClearance
      if (gap + 0.005 >= minimumClearance) {
        if (
          sameNet ||
          !viaA.layers.some((layer) => viaB.layers.includes(layer))
        )
          continue
        gap = distance - viaA.outer_diameter / 2 - viaB.outer_diameter / 2
        minimumClearance = copperClearance
        if (gap >= 0 && gap + 0.005 >= minimumClearance) continue
      }
      const pairId = [viaA.pcb_via_id, viaB.pcb_via_id].sort().join("_")
      if (reportedPairs.has(pairId)) continue
      reportedPairs.add(pairId)
      const center = {
        x: (viaA.x + viaB.x) / 2,
        y: (viaA.y + viaB.y) / 2,
      }
      const error = {
        type: "pcb_via_clearance_error",
        error_type: "pcb_via_clearance_error",
        pcb_error_id: `${sameNet ? "same_net" : "different_net"}_vias_close_${pairId}`,
        message: `Vias ${getDrcReadableElementName(circuitJson, viaA.pcb_via_id)} and ${getDrcReadableElementName(circuitJson, viaB.pcb_via_id)}${sameNet ? "" : " from different nets"} are too close together (gap: ${gap.toFixed(3)}mm)`,
        pcb_via_ids: [viaA.pcb_via_id, viaB.pcb_via_id],
        minimum_clearance: minimumClearance,
        actual_clearance: gap,
        pcb_center: center,
      }
      if (sameNet) sameNetErrors.push(error)
      else differentNetErrors.push(error)
    }
  }
  return [...sameNetErrors, ...differentNetErrors]
}
