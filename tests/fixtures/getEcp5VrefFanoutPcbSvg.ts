import type { AnyCircuitElement } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

export const getEcp5VrefFanoutPcbSvg = ({
  circuitJson,
  node,
  routedBranchCount,
  focused = false,
}: {
  circuitJson: AnyCircuitElement[]
  node: NodeWithPortPoints
  routedBranchCount: number
  focused?: boolean
}): string => {
  const focusedViewSizeMm = 4.2
  const view = circuitJson.map((element): AnyCircuitElement => {
    if (!focused || element.type !== "pcb_board") return element
    return {
      ...element,
      center: node.center,
      width: focusedViewSizeMm,
      height: focusedViewSizeMm,
      outline: undefined,
    }
  })
  const referenceNames = new Set(["C2", "C3", "R1", "R2"])
  for (const component of circuitJson) {
    if (
      component.type !== "source_component" ||
      !referenceNames.has(component.name)
    ) {
      continue
    }
    const pcbComponent = circuitJson.find(
      (element) =>
        element.type === "pcb_component" &&
        element.source_component_id === component.source_component_id,
    )
    if (pcbComponent?.type !== "pcb_component") {
      throw new Error(`Missing native PCB component ${component.name}`)
    }
    if (pcbComponent.layer !== "top") {
      throw new Error(`Unexpected VREF component layer for ${component.name}`)
    }
    const labelFontSizeMm = 0.25
    view.push({
      type: "pcb_fabrication_note_text",
      pcb_fabrication_note_text_id: `reference_${component.name}`,
      pcb_component_id: pcbComponent.pcb_component_id,
      layer: pcbComponent.layer,
      text: component.name,
      font: "tscircuit2024",
      font_size: labelFontSizeMm,
      color: "#0f172a",
      anchor_alignment: "center",
      anchor_position: {
        x: pcbComponent.center.x + pcbComponent.width / 2 + labelFontSizeMm,
        y: pcbComponent.center.y,
      },
    })
  }
  const svg = convertCircuitJsonToPcbSvg(view, {
    width: 1000,
    height: focused ? 1000 : 600,
    backgroundColor: "white",
    renderSolderMask: false,
    drawPaddingOutsideBoard: !focused,
    shouldDrawErrors: false,
    shouldDrawRatsNest: false,
    includeVersion: false,
    colorOverrides: {
      copper: {
        top: "#dc2626",
        bottom: "#2563eb",
        inner1: "#16a34a",
        inner2: "#ca8a04",
        inner3: "#c026d3",
        inner4: "#0891b2",
      },
      boardOutline: "#475569",
    },
  })
  return svg.replace(
    "</svg>",
    `<rect x="15" y="15" width="970" height="54" rx="6" fill="white" stroke="#475569"/><text x="30" y="51" font-family="sans-serif" font-size="22" fill="#0f172a">ECP5 VREF: ${routedBranchCount}/3 branches; full board incomplete</text></svg>`,
  )
}
