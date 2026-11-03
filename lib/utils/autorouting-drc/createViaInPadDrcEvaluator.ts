import type { AnyCircuitElement } from "circuit-json"
import RBush from "rbush"
import {
  compileTraceClearanceObstacle,
  getTraceObstacleClearance,
  type IndexedObstacle,
} from "./createTraceObstacleClearanceEvaluator"

type Pad = Extract<
  AnyCircuitElement,
  { type: "pcb_smtpad" | "pcb_plated_hole" }
>

export type ViaInPadDrcError = Record<string, unknown> & {
  pcb_placement_error_id: string
  pcb_via_id: string
  pcb_pad_id: string
  center: { x: number; y: number }
}

type ViaInPadDrcEvaluator = (
  circuitJson: AnyCircuitElement[],
) => ViaInPadDrcError[]

/** Pad drilling is a manufacturing constraint, including on the via's own net. */
export function createViaInPadDrcEvaluator(
  staticCircuitJson: AnyCircuitElement[],
): ViaInPadDrcEvaluator {
  const padIndex = new RBush<IndexedObstacle>()
  const pads = staticCircuitJson.filter(
    (element): element is Pad =>
      element.type === "pcb_smtpad" || element.type === "pcb_plated_hole",
  )
  padIndex.load(pads.map(compileTraceClearanceObstacle))
  return (circuitJson): ViaInPadDrcError[] => {
    const errors: ViaInPadDrcError[] = []
    for (const via of circuitJson) {
      if (via.type !== "pcb_via") continue
      const radius = via.hole_diameter / 2
      const candidates = padIndex.search({
        minX: via.x - radius,
        minY: via.y - radius,
        maxX: via.x + radius,
        maxY: via.y + radius,
      })
      for (const pad of candidates) {
        if (!via.layers.some((layer) => pad.layers.includes(layer))) continue
        const clearance = getTraceObstacleClearance(
          via,
          via,
          via.hole_diameter,
          pad,
        )
        if (clearance.gap >= -1e-6) continue
        errors.push({
          type: "pcb_placement_error",
          error_type: "pcb_placement_error",
          pcb_placement_error_id: `via_in_pad_${via.pcb_via_id}_${pad.id}`,
          message: `Via hole ${via.pcb_via_id} overlaps pad ${pad.id}`,
          pcb_via_id: via.pcb_via_id,
          pcb_via_ids: [via.pcb_via_id],
          pcb_trace_id: via.pcb_trace_id,
          pcb_pad_id: pad.id,
          center: { x: via.x, y: via.y },
          actual_clearance: clearance.gap,
          minimum_clearance: 0,
        })
      }
    }
    return errors
  }
}
