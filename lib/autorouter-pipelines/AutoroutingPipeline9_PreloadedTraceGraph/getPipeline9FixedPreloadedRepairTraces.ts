import type { SimplifiedPcbTrace as RepairTrace } from "high-density-repair03/lib"
import type { SimplifiedPcbTrace } from "lib/types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"

/** Retain fixed barrel copper without inventing a drilled via for repair04. */
export const getPipeline9FixedPreloadedRepairTraces = ({
  traces,
  layerCount,
}: {
  traces: readonly SimplifiedPcbTrace[]
  layerCount: number
}): RepairTrace[] =>
  traces.flatMap((trace): RepairTrace[] => {
    const sections: RepairTrace["route"][] = []
    let ordinaryCopper: RepairTrace["route"] = []
    for (const point of trace.route) {
      if (point.route_type !== "through_obstacle") {
        ordinaryCopper.push(point)
        continue
      }
      if (ordinaryCopper.length > 0) sections.push(ordinaryCopper)
      ordinaryCopper = []
      const startZ = mapLayerNameToZ(point.from_layer, layerCount)
      const endZ = mapLayerNameToZ(point.to_layer, layerCount)
      for (let z = Math.min(startZ, endZ); z <= Math.max(startZ, endZ); z++) {
        const layer = mapZToLayerName(z, layerCount)
        sections.push([
          { route_type: "wire", ...point.start, width: point.width, layer },
          { route_type: "wire", ...point.end, width: point.width, layer },
        ])
      }
    }
    if (ordinaryCopper.length > 0) sections.push(ordinaryCopper)
    return sections.map((route, index): RepairTrace => ({
      ...trace,
      pcb_trace_id:
        sections.length === 1
          ? trace.pcb_trace_id
          : `${trace.pcb_trace_id}__fixed_section_${index}`,
      route,
    }))
  })
