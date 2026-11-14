import type { AnyCircuitElement } from "circuit-json"
import { convertCircuitJsonToPcbSvg } from "circuit-to-svg"

export function getH616JointRepairPcbSvg({
  circuitJson,
  phaseAccepted,
  drcErrorCount,
  focused = false,
}: {
  circuitJson: AnyCircuitElement[]
  phaseAccepted: boolean
  drcErrorCount: number
  focused?: boolean
}): string {
  let viewCircuit = circuitJson
  if (focused) {
    const ramSource = circuitJson.find(
      (element) => element.type === "source_component" && element.name === "U2",
    )
    if (!ramSource || ramSource.type !== "source_component") {
      throw new Error("Missing native RAM source component")
    }
    const ram = circuitJson.find(
      (element) =>
        element.type === "pcb_component" &&
        element.source_component_id === ramSource.source_component_id,
    )
    if (!ram || ram.type !== "pcb_component") {
      throw new Error("Missing native RAM")
    }
    // Only the camera changes; every native pad and copper point stays put.
    viewCircuit = circuitJson.map((element) =>
      element.type === "pcb_board"
        ? {
            ...element,
            center: ram.center,
            width: ram.width + 4,
            height: ram.height + 4,
            outline: undefined,
          }
        : element,
    )
  }
  const status = phaseAccepted
    ? "Remaining phase accepted"
    : "Remaining phase rejected"
  const statusColor = phaseAccepted
    ? drcErrorCount > 0
      ? "#b91c1c"
      : "#166534"
    : "#92400e"
  return convertCircuitJsonToPcbSvg(viewCircuit, {
    width: 1000,
    height: focused ? 1000 : 2200,
    backgroundColor: "white",
    drawPaddingOutsideBoard: !focused,
    renderSolderMask: false,
    shouldDrawErrors: false,
    shouldDrawRatsNest: false,
    includeVersion: false,
    colorOverrides: {
      copper: { top: "#dc2626", bottom: "#2563eb" },
      silkscreen: { top: "#334155", bottom: "#334155" },
      boardOutline: "#475569",
    },
  }).replace(
    "</svg>",
    `<rect x="15" y="8" width="970" height="42" rx="4" fill="white" stroke="${statusColor}"/><text x="500" y="35" text-anchor="middle" font-family="sans-serif" font-size="22" fill="${statusColor}">${status}; accepted PCB DRC: ${drcErrorCount}</text></svg>`,
  )
}
