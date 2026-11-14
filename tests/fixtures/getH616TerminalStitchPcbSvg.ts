import type { AnyCircuitElement } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"

export const getH616TerminalStitchPcbSvg = ({
  circuit,
  focused = false,
}: {
  circuit: AnyCircuitElement[]
  focused?: boolean
}): string => {
  const source = circuit.find(
    (element) => element.type === "source_component" && element.name === "C3",
  )!
  if (source.type !== "source_component") throw new Error("Missing native C3")
  const component = circuit.find(
    (element) =>
      element.type === "pcb_component" &&
      element.source_component_id === source.source_component_id,
  )!
  if (component.type !== "pcb_component") throw new Error("Missing C3 PCB")
  const view = circuit.map((element): AnyCircuitElement => {
    if (!focused || element.type !== "pcb_board") return element
    // Only change the camera bounds; all native pads and copper stay in place.
    return {
      ...element,
      center: component.center,
      width: component.width + 3,
      height: component.height + 3,
      outline: undefined,
    }
  })
  const svg = convertCircuitJsonToPcbSvg(view, {
    width: focused ? 900 : 1000,
    height: focused ? 900 : 2200,
    layer: focused ? "bottom" : undefined,
    backgroundColor: "white",
    colorOverrides: {
      copper: { top: "#dc2626", bottom: "#2563eb" },
      boardOutline: "#475569",
      silkscreen: { top: "#334155", bottom: "#334155" },
    },
    showSolderMask: false,
    drawPaddingOutsideBoard: !focused,
    shouldDrawErrors: false,
    shouldDrawRatsNest: false,
    includeVersion: false,
  })
  return focused
    ? svg.replace(
        "</svg>",
        '<text x="450" y="45" text-anchor="middle" font-family="sans-serif" font-size="24" fill="#334155">C3 / SVREF: bottom copper</text></svg>',
      )
    : svg
}
