import type { AnyCircuitElement } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"

export const getH616PreloadReachabilityPcbSvg = ({
  circuitJson,
  routedNetCount,
  focused = false,
}: {
  circuitJson: AnyCircuitElement[]
  routedNetCount: number
  focused?: boolean
}): string => {
  const ram = circuitJson.find(
    (element) => element.type === "source_component" && element.name === "U2",
  )
  if (ram?.type !== "source_component") throw new Error("Missing RAM U2")
  const referencePort = circuitJson.find(
    (element) =>
      element.type === "source_port" &&
      element.source_component_id === ram.source_component_id &&
      element.name === "NATIVE_M8",
  )
  if (referencePort?.type !== "source_port") throw new Error("Missing U2.M8")
  const pcbPort = circuitJson.find(
    (element) =>
      element.type === "pcb_port" &&
      element.source_port_id === referencePort.source_port_id,
  )
  if (pcbPort?.type !== "pcb_port") throw new Error("Missing U2.M8 PCB port")
  const referenceNetIds = new Set(
    circuitJson.flatMap((element) =>
      element.type === "source_trace" &&
      element.connected_source_port_ids.includes(referencePort.source_port_id)
        ? (element.connected_source_net_ids ?? [])
        : [],
    ),
  )
  const referenceTraceIds = new Set(
    circuitJson.flatMap((element) =>
      element.type === "pcb_trace" &&
      element.source_trace_id !== undefined &&
      referenceNetIds.has(element.source_trace_id)
        ? [element.pcb_trace_id]
        : [],
    ),
  )
  const focusedViewSizeMm = 4
  const view = circuitJson.flatMap((element): AnyCircuitElement[] => {
    if (!focused) return [element]
    if (element.type === "pcb_trace") {
      return referenceTraceIds.has(element.pcb_trace_id) ? [element] : []
    }
    if (element.type === "pcb_via") {
      return element.pcb_trace_id && referenceTraceIds.has(element.pcb_trace_id)
        ? [element]
        : []
    }
    if (element.type !== "pcb_board") return [element]
    // Camera only: the native pads and copper remain in board-world mm.
    return [
      {
        ...element,
        center: { x: pcbPort.x, y: pcbPort.y },
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
      copper: { top: "#dc2626", bottom: "#2563eb" },
      boardOutline: "#475569",
    },
  })
  const title = focused
    ? "U2.M8 / C3.1: RAM reference copper"
    : `H616 full PCB: ${routedNetCount}/121 routed nets`
  return svg.replace(
    "</svg>",
    `<rect x="15" y="15" width="930" height="54" rx="6" fill="white" stroke="#475569"/><text x="30" y="51" font-family="sans-serif" font-size="24" fill="#0f172a">${title}</text></svg>`,
  )
}
