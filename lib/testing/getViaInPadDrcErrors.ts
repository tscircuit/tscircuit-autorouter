import { Point as GeometryPoint } from "@flatten-js/core"
import { getPlatedHolePolygon, getSmtPadPolygon } from "@tscircuit/circuit-json-util"
import { checkViasInPads } from "@tscircuit/checks"
import type { AnyCircuitElement, PcbPadPadClearanceError, PcbPlatedHole, PcbSmtPad } from "circuit-json"
import type { Point } from "graphics-debug"

export type ViaInPadDrcError = PcbPadPadClearanceError & Record<string, unknown> & {
  pcb_trace_id?: string
  pcb_via_ids: [string]
  center: Point
}

/** Gives physical drill overlaps the identities required by via repair. */
export const getViaInPadDrcErrors = (
  circuitJson: AnyCircuitElement[],
): ViaInPadDrcError[] => {
  const vias = circuitJson.filter((element) => element.type === "pcb_via")
  const pads = new Map<string, PcbSmtPad | PcbPlatedHole>()
  for (const element of circuitJson) {
    if (element.type === "pcb_smtpad") {
      pads.set(element.pcb_smtpad_id, element)
    } else if (element.type === "pcb_plated_hole") {
      pads.set(element.pcb_plated_hole_id, element)
    }
  }

  return checkViasInPads(circuitJson).map((error) => {
    const via = vias.find((candidate) => {
      const prefix = `via_in_pad_${candidate.pcb_via_id}_`
      return error.pcb_placement_error_id.startsWith(prefix) &&
        pads.has(error.pcb_placement_error_id.slice(prefix.length))
    })
    if (!via) {
      throw new Error(`Via-in-pad error has no via: ${error.pcb_placement_error_id}`)
    }
    const padId = error.pcb_placement_error_id.slice(
      `via_in_pad_${via.pcb_via_id}_`.length,
    )

    const pad = pads.get(padId)!
    const padPolygon = pad.type === "pcb_smtpad"
      ? getSmtPadPolygon(pad)
      : getPlatedHolePolygon(pad)
    // Drilling restrictions apply to the outer pad, including a plated hole's
    // existing drill. Use its outer face rather than the copper-only annulus.
    const outerFace = [...padPolygon.faces].sort((a, b) => b.area() - a.area())[0]
    if (!outerFace) throw new Error(`Via-in-pad error has empty pad: ${padId}`)
    const polygon = outerFace.toPolygon()
    const point = new GeometryPoint(via.x, via.y)
    const boundaryDistance = Math.min(
      ...[...polygon.edges].map((edge) => point.distanceTo(edge.shape)[0]),
    )
    const gap = (polygon.contains(point) ? -boundaryDistance : boundaryDistance)
      - via.hole_diameter / 2

    return {
      type: "pcb_pad_pad_clearance_error",
      error_type: "pcb_pad_pad_clearance_error",
      pcb_pad_pad_clearance_error_id: error.pcb_placement_error_id,
      pcb_trace_id: via.pcb_trace_id,
      pcb_pad_ids: [via.pcb_via_id, padId],
      pcb_via_ids: [via.pcb_via_id],
      minimum_clearance: 0,
      actual_clearance: gap,
      worst_actual_clearance: gap,
      message: `${error.message} (${via.pcb_via_id}, ${padId}; gap: ${gap.toFixed(6)}mm, required: 0mm)`,
      subcircuit_id: error.subcircuit_id,
      center: { x: via.x, y: via.y },
    }
  })
}
