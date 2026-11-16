import type { AnyCircuitElement } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"

type Imx6CircuitSnapshotInput = {
  circuitJson: AnyCircuitElement[]
  connectedNetCount: number
  drcErrorCount: number
}

/** Keep the native board context and a close-up of the CPU's A9/CS0 escape. */
export function getImx6PolylineCircuitSnapshots({
  circuitJson,
  connectedNetCount,
  drcErrorCount,
}: Imx6CircuitSnapshotInput): { board: string; clearance: string } {
  const renderOptions = {
    backgroundColor: "white",
    colorOverrides: {
      substrate: "#f5f8f3",
      boardOutline: "#466047",
      drill: "#ffffff",
      copper: {
        top: "#dc2626",
        bottom: "#2563eb",
        inner1: "#16a34a",
        inner2: "#ca8a04",
      },
      silkscreen: { top: "#334155", bottom: "#334155" },
    },
    shouldDrawErrors: false,
    shouldDrawRatsNest: false,
    includeVersion: false,
  }
  const totalNetCount = circuitJson.filter(
    (element) => element.type === "source_net",
  ).length
  const color = drcErrorCount === 0 ? "#166534" : "#b91c1c"
  const summary = `<rect x="8" y="8" width="1184" height="42" fill="white" stroke="${color}"/><text x="20" y="36" font-family="Arial,sans-serif" font-size="19" fill="${color}">i.MX6: ${connectedNetCount}/${totalNetCount} nets connected · DDR DRC errors: ${drcErrorCount}</text>`
  const board = convertCircuitJsonToPcbSvg(circuitJson, {
    ...renderOptions,
    width: 1400,
    height: 1000,
  }).replace("</svg>", `${summary}</svg>`)
  const focusedNetIds = new Set(["source_net_238", "source_net_279"])
  const focusedTraceIds = new Set(
    circuitJson.flatMap((element) =>
      element.type === "pcb_trace" &&
      focusedNetIds.has(element.source_trace_id!)
        ? [element.pcb_trace_id]
        : [],
    ),
  )
  const sourceCpu = circuitJson.find(
    (element) => element.type === "source_component" && element.name === "U7",
  )
  if (sourceCpu?.type !== "source_component") {
    throw new Error("Missing native i.MX6 CPU")
  }
  const cpu = circuitJson.find(
    (element) =>
      element.type === "pcb_component" &&
      element.source_component_id === sourceCpu.source_component_id,
  )
  if (cpu?.type !== "pcb_component") {
    throw new Error("Missing native i.MX6 PCB component")
  }
  const sourcePortIds = new Set(
    circuitJson.flatMap((element) =>
      element.type === "source_trace" &&
      element.connected_source_net_ids?.some((netId) =>
        focusedNetIds.has(netId),
      )
        ? element.connected_source_port_ids
        : [],
    ),
  )
  const ports = circuitJson.filter(
    (element) =>
      element.type === "pcb_port" &&
      element.pcb_component_id === cpu.pcb_component_id &&
      sourcePortIds.has(element.source_port_id),
  )
  if (ports.length !== 2) throw new Error("Missing native A9/CS0 CPU terminals")
  const positions = ports.map((port) => {
    if (port.type !== "pcb_port") throw new Error("Expected native PCB port")
    return { x: port.x, y: port.y }
  })
  // One native BGA pitch around the two CPU terminals; drawing bounds only.
  const focusPaddingMm = 0.8
  const minX = Math.min(...positions.map((point) => point.x)) - focusPaddingMm
  const maxX = Math.max(...positions.map((point) => point.x)) + focusPaddingMm
  const minY = Math.min(...positions.map((point) => point.y)) - focusPaddingMm
  const maxY = Math.max(...positions.map((point) => point.y)) + focusPaddingMm
  const focusedCircuit = circuitJson
    .filter((element) => {
      if (element.type === "pcb_trace") {
        return focusedTraceIds.has(element.pcb_trace_id)
      }
      if (element.type === "pcb_via") {
        return focusedTraceIds.has(element.pcb_trace_id!)
      }
      return true
    })
    .map((element): AnyCircuitElement => {
      if (element.type !== "pcb_board") return element
      return {
        ...element,
        center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
        width: maxX - minX,
        height: maxY - minY,
        outline: undefined,
      }
    })
  return {
    board,
    clearance: convertCircuitJsonToPcbSvg(focusedCircuit, {
      ...renderOptions,
      width: 1000,
      height: 1000,
      drawPaddingOutsideBoard: false,
    }),
  }
}
