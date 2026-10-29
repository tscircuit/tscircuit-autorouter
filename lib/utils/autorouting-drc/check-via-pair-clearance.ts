import { getReadableNameForElement } from "@tscircuit/circuit-json-util"
import type { AnyCircuitElement, PcbVia } from "circuit-json"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import RBush from "rbush"

type IndexedVia = {
  minX: number
  minY: number
  maxX: number
  maxY: number
  order: number
  via: PcbVia
}

/** The joint repair objective measures drill-hole edge clearance. */
export const checkViaPairClearance = (
  circuitJson: AnyCircuitElement[],
  connMap: ConnectivityMap,
): Record<string, unknown>[] => {
  const vias = circuitJson.filter((element) => element.type === "pcb_via")
  const indexedVias: IndexedVia[] = vias.map((via, order) => ({
    minX: via.x - via.hole_diameter / 2,
    minY: via.y - via.hole_diameter / 2,
    maxX: via.x + via.hole_diameter / 2,
    maxY: via.y + via.hole_diameter / 2,
    via,
    order,
  }))
  const index = new RBush<IndexedVia>()
  index.load(indexedVias)
  const sameNetErrors: Record<string, unknown>[] = []
  const differentNetErrors: Record<string, unknown>[] = []
  for (const item of indexedVias) {
    const candidates = index.search({
      minX: item.minX - 0.1,
      minY: item.minY - 0.1,
      maxX: item.maxX + 0.1,
      maxY: item.maxY + 0.1,
    }).sort((left, right) => left.order - right.order)
    for (const candidate of candidates) {
      if (candidate.order <= item.order) continue
      const viaA = item.via
      const viaB = candidate.via
      const distance = Math.hypot(viaA.x - viaB.x, viaA.y - viaB.y)
      if (distance <= 0.005) continue
      const gap = distance - viaA.hole_diameter / 2 - viaB.hole_diameter / 2
      if (gap + 0.005 >= 0.1) continue
      const sameNet = connMap.areIdsConnected(viaA.pcb_via_id, viaB.pcb_via_id)
      const pairId = [viaA.pcb_via_id, viaB.pcb_via_id].sort().join("_")
      const center = {
        x: (viaA.x + viaB.x) / 2,
        y: (viaA.y + viaB.y) / 2,
      }
      const error = {
        type: "pcb_via_clearance_error",
        error_type: "pcb_via_clearance_error",
        pcb_error_id: `${sameNet ? "same_net" : "different_net"}_vias_close_${pairId}`,
        message: `Vias ${getReadableNameForElement(circuitJson, viaA.pcb_via_id)} and ${getReadableNameForElement(circuitJson, viaB.pcb_via_id)}${sameNet ? "" : " from different nets"} are too close together (gap: ${gap.toFixed(3)}mm)`,
        pcb_via_ids: [viaA.pcb_via_id, viaB.pcb_via_id],
        minimum_clearance: 0.1,
        actual_clearance: gap,
        pcb_center: center,
        center,
      }
      if (sameNet) sameNetErrors.push(error)
      else differentNetErrors.push(error)
    }
  }
  return [...sameNetErrors, ...differentNetErrors]
}
