import type { AnyCircuitElement } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

type BoundaryCopperPcbView = {
  circuitJson: AnyCircuitElement[]
  node: NodeWithPortPoints
  errorCount: number
  focused?: boolean
}

export const getEcp5BoundaryCopperPcbSvg = ({
  circuitJson,
  node,
  errorCount,
  focused = false,
}: BoundaryCopperPcbView): string => {
  const focusedViewSizeMm = 3
  const view = circuitJson.map((element): AnyCircuitElement => {
    if (!focused || element.type !== "pcb_board") return element
    // Change only the camera; all native component and pad geometry is retained.
    return {
      ...element,
      center: { x: node.center.x, y: node.center.y - node.height / 2 },
      width: focusedViewSizeMm,
      height: focusedViewSizeMm,
      outline: undefined,
    }
  })
  const svg = convertCircuitJsonToPcbSvg(view, {
    width: 1000,
    height: focused ? 1000 : 1800,
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
    `<rect x="15" y="15" width="970" height="54" rx="6" fill="white" stroke="#475569"/><text x="30" y="51" font-family="sans-serif" font-size="22" fill="#0f172a">RAM_A13 / RAM_RAS# regional candidate: ${errorCount} trace/via errors</text></svg>`,
  )
}
