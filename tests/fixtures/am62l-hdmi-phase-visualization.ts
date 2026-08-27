import type { AnyCircuitElement } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import realFootprints from "../../fixtures/bug-reports/am62l-hdmi-phase3-fallback/am62l-hdmi-real-footprints.circuit.json" with {
  type: "json",
}

const realFootprintCircuitJson = realFootprints as AnyCircuitElement[]

const componentLabels = realFootprintCircuitJson
  .filter((element) => element.type === "pcb_component")
  .map((pcbComponent) => {
    const sourceComponent = realFootprintCircuitJson.find(
      (element) =>
        element.type === "source_component" &&
        element.source_component_id === pcbComponent.source_component_id,
    )
    if (!sourceComponent || sourceComponent.type !== "source_component") {
      throw new Error(
        `Missing source component for ${pcbComponent.pcb_component_id}`,
      )
    }
    return {
      x: pcbComponent.center.x,
      text: `${sourceComponent.name}  ${sourceComponent.manufacturer_part_number}`,
      pcbComponentId: pcbComponent.pcb_component_id,
    }
  })

const getStatusNotes = (status: "unrouted" | "routed"): AnyCircuitElement[] => {
  const color = status === "unrouted" ? "#dc2626" : "#15803d"
  const statusText =
    status === "unrouted"
      ? "UNROUTED: Pipeline 9 failed before producing the 16 HDMI segments"
      : "ROUTED: all 8 HDMI nets completed with 16 new route segments"

  return [
    ...componentLabels.map(
      ({ x, text, pcbComponentId }, index) =>
        ({
          type: "pcb_fabrication_note_text",
          pcb_fabrication_note_text_id: `component_label_${index}`,
          pcb_component_id: pcbComponentId,
          font: "tscircuit2024",
          font_size: 0.62,
          text,
          layer: "top",
          anchor_position: { x, y: 10.45 },
          anchor_alignment: "center",
          color: "#0f172a",
        }) as AnyCircuitElement,
    ),
    {
      type: "pcb_fabrication_note_text",
      pcb_fabrication_note_text_id: "routing_result",
      pcb_component_id: "pcb_component_20",
      font: "tscircuit2024",
      font_size: 0.72,
      text: statusText,
      layer: "top",
      anchor_position: { x: 0, y: -11.25 },
      anchor_alignment: "center",
      color,
    } as AnyCircuitElement,
  ]
}

export const getAm62lHdmiRouteVisualization = ({
  inputSrj,
  traces,
  status,
}: {
  inputSrj: SimpleRouteJson
  traces: SimplifiedPcbTrace[]
  status: "unrouted" | "routed"
}) => {
  const routedPhaseCircuitJson = convertToCircuitJson(inputSrj, traces, {
    minTraceWidth: inputSrj.minTraceWidth,
    minViaDiameter: inputSrj.minViaDiameter,
    originalSrj: inputSrj,
    includeOriginalConnections: true,
  }).filter(
    (element) =>
      element.type !== "pcb_smtpad" &&
      element.type !== "pcb_plated_hole" &&
      element.type !== "pcb_hole",
  )

  const circuitJson = [
    {
      type: "pcb_board",
      pcb_board_id: "am62l_hdmi_phase_board",
      center: { x: 0, y: 0 },
      width: 80,
      height: 26,
      thickness: 1.6,
      num_layers: inputSrj.layerCount,
      material: "fr4",
    },
    ...realFootprintCircuitJson,
    ...routedPhaseCircuitJson,
    ...getStatusNotes(status),
  ] as AnyCircuitElement[]

  return convertCircuitJsonToPcbSvg(circuitJson, {
    width: 1200,
    matchBoardAspectRatio: true,
    backgroundColor: "#f8fafc",
    drawPaddingOutsideBoard: false,
    colorOverrides: {
      copper: {
        top: "#b45309",
        inner1: "#2563eb",
        inner2: "#7c3aed",
        bottom: "#0891b2",
      },
      silkscreen: { top: "#334155", bottom: "#64748b" },
      boardOutline: "#94a3b8",
    },
  })
}
