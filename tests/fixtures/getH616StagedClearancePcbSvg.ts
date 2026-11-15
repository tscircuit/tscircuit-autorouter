import type { AnyCircuitElement } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"

type PcbSnapshotInput = {
  circuitJson: AnyCircuitElement[]
  errorCount: number
  focused?: boolean
}

export const getH616StagedClearancePcbSvg = ({
  circuitJson,
  errorCount,
  focused = false,
}: PcbSnapshotInput): string => {
  const ramSource = circuitJson.find(
    (element) => element.type === "source_component" && element.name === "U2",
  )
  if (ramSource?.type !== "source_component") throw new Error("Missing U2")
  const ram = circuitJson.find(
    (element) =>
      element.type === "pcb_component" &&
      element.source_component_id === ramSource.source_component_id,
  )
  if (ram?.type !== "pcb_component") throw new Error("Missing U2 PCB")
  const ramPorts = new Set(
    circuitJson.flatMap((element) =>
      element.type === "source_port" &&
      element.source_component_id === ramSource.source_component_id &&
      ["NATIVE_H8", "NATIVE_J3", "NATIVE_L8"].includes(element.name)
        ? [element.source_port_id]
        : [],
    ),
  )
  const focusedNetIds = new Set(
    circuitJson.flatMap((element) =>
      element.type === "source_trace" &&
      element.connected_source_port_ids.some((port) => ramPorts.has(port))
        ? (element.connected_source_net_ids ?? [])
        : [],
    ),
  )
  const focusedTraceIds = new Set(
    circuitJson.flatMap((element) =>
      element.type === "pcb_trace" &&
      element.source_trace_id !== undefined &&
      focusedNetIds.has(element.source_trace_id)
        ? [element.pcb_trace_id]
        : [],
    ),
  )
  const view = circuitJson.flatMap((element): AnyCircuitElement[] => {
    if (!focused) return [element]
    if (element.type === "pcb_trace") {
      return focusedTraceIds.has(element.pcb_trace_id) ? [element] : []
    }
    if (element.type === "pcb_via") {
      return element.pcb_trace_id && focusedTraceIds.has(element.pcb_trace_id)
        ? [element]
        : []
    }
    if (element.type !== "pcb_board") return [element]
    // Only the camera and displayed nets change; native geometry is retained.
    return [
      {
        ...element,
        center: { x: ram.center.x + ram.width / 2 - 1, y: ram.center.y },
        width: 6,
        height: 6,
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
    ? "U2 DQ5 / SRAS / ZQ: all copper layers"
    : "H616 full PCB: accepted routing"
  return svg.replace(
    "</svg>",
    `<rect x="15" y="15" width="930" height="54" rx="6" fill="white" stroke="#475569"/><text x="30" y="51" font-family="sans-serif" font-size="24" fill="#0f172a">${title} · Physical DRC errors: ${errorCount}</text></svg>`,
  )
}
