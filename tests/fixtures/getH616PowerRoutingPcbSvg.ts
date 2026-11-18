import type { AnyCircuitElement } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"

type H616PowerRoutingPcbView = {
  circuitJson: AnyCircuitElement[]
  connectedNetCount: number
  requestedNetCount: number
  errorCount: number
  focusCenter: { x: number; y: number }
  focused?: boolean
  title?: string
}

export function getH616PowerRoutingPcbSvg({
  circuitJson,
  connectedNetCount,
  requestedNetCount,
  errorCount,
  focusCenter,
  focused = false,
  title = focused ? "H616 ground routing" : "H616 full PCB",
}: H616PowerRoutingPcbView): string {
  const focusedViewSizeMm = 3
  const view = circuitJson.flatMap((element): AnyCircuitElement[] => {
    if (focused && element.type === "pcb_fabrication_note_text") return []
    if (!focused || element.type !== "pcb_board") return [element]
    return [
      {
        ...element,
        center: focusCenter,
        width: focusedViewSizeMm,
        height: focusedViewSizeMm,
        outline: undefined,
      },
    ]
  })
  const svg = convertCircuitJsonToPcbSvg(view, {
    width: 1000,
    height: focused ? 1000 : 2000,
    backgroundColor: "white",
    renderSolderMask: false,
    drawPaddingOutsideBoard: !focused,
    shouldDrawErrors: false,
    shouldDrawRatsNest: false,
    includeVersion: false,
    colorOverrides: {
      drill: "#ffffff",
      copper: {
        top: "#dc2626",
        bottom: "#2563eb",
        inner1: "#16a34a",
        inner2: "#ca8a04",
      },
      boardOutline: "#475569",
    },
  })
  return svg.replace(
    "</svg>",
    `<rect x="15" y="15" width="970" height="54" rx="6" fill="white" stroke="#475569"/><text x="30" y="51" font-family="sans-serif" font-size="20" fill="#0f172a">${title}: ${connectedNetCount}/${requestedNetCount} connected nets; ${errorCount} physical DRC errors</text></svg>`,
  )
}
