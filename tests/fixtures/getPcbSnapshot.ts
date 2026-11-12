import type { AnyCircuitElement } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import {
  convertToCircuitJson,
  createPcbBoardElement,
} from "lib/testing/utils/convertToCircuitJson"

/** Extend only the rendering above the routed board, leaving copper untouched. */
export function getPcbSnapshot(
  srj: SimpleRouteJson,
  traces: SimplifiedPcbTrace[],
  notes: string[],
  artwork: AnyCircuitElement[],
): string {
  const noteHeight = 5.5
  const board = createPcbBoardElement({
    ...srj,
    bounds: { ...srj.bounds, maxY: srj.bounds.maxY + noteHeight },
  })
  const circuitJson = convertToCircuitJson(srj, traces)
  circuitJson.push(board, ...artwork)
  notes.forEach((text, index) => {
    circuitJson.push({
      type: "pcb_silkscreen_text",
      pcb_silkscreen_text_id: `note_${index}`,
      pcb_component_id: "pcb_component_0",
      ccw_rotation: 0,
      font: "tscircuit2024",
      font_size: (srj.bounds.maxX - srj.bounds.minX) / 70,
      text,
      layer: "top",
      color: "#ffffff",
      anchor_alignment: "center",
      anchor_position: {
        x: (srj.bounds.minX + srj.bounds.maxX) / 2,
        y: srj.bounds.maxY + noteHeight - 0.9 - index * 1.1,
      },
    })
  })
  return convertCircuitJsonToPcbSvg(circuitJson, { width: 1200, height: 975 })
}
