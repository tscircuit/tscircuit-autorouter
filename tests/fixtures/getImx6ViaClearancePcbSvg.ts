import type { AnyCircuitElement } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"

type Imx6ViaClearancePcbView = {
  circuitJson: AnyCircuitElement[]
  connectedNetCount: number
  errorCount: number
  focusCenter: { x: number; y: number }
  focused?: boolean
  showAllLayers?: boolean
}

export function getImx6ViaClearancePcbSvg({
  circuitJson,
  connectedNetCount,
  errorCount,
  focusCenter,
  focused = false,
  showAllLayers = false,
}: Imx6ViaClearancePcbView): string {
  const focusedViewSizeMm = 4
  const view = circuitJson.map((element): AnyCircuitElement => {
    if (!focused || element.type !== "pcb_board") return element
    // Crop the native PCB camera without changing its pads or routed copper.
    return {
      ...element,
      center: focusCenter,
      width: focusedViewSizeMm,
      height: focusedViewSizeMm,
      outline: undefined,
    }
  })
  const svg = convertCircuitJsonToPcbSvg(view, {
    width: 1000,
    height: focused ? 1000 : 800,
    backgroundColor: "white",
    renderSolderMask: false,
    layer: focused && !showAllLayers ? "top" : undefined,
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
    `<rect x="15" y="15" width="970" height="54" rx="6" fill="white" stroke="#475569"/><text x="30" y="51" font-family="sans-serif" font-size="22" fill="#0f172a">i.MX6 DDR: ${connectedNetCount} connected nets; ${errorCount} physical DRC errors</text></svg>`,
  )
}
