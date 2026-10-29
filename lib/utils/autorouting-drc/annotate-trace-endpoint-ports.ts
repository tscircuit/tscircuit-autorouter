import type { AnyCircuitElement } from "circuit-json"

/** Preserves endpoint annotations used by collision and continuity scoring. */
export const annotateTraceEndpointPorts = (
  circuitJson: AnyCircuitElement[],
): void => {
  const ports = circuitJson.filter((element) => element.type === "pcb_port")
  const pads = circuitJson.filter((element) => element.type === "pcb_smtpad")
  const traces = circuitJson.filter((element) => element.type === "pcb_trace")
  for (const trace of traces) {
    for (const [index, point] of trace.route.entries()) {
      if (point.route_type !== "wire") continue
      const needsStartPort = index === 0 && !point.start_pcb_port_id
      const needsEndPort =
        index === trace.route.length - 1 && !point.end_pcb_port_id
      if (!needsStartPort && !needsEndPort) continue
      const directPort = ports.find(
        (port) => Math.hypot(port.x - point.x, port.y - point.y) < 0.01,
      )
      let portId = directPort?.pcb_port_id
      if (!portId) {
        const pad = pads.find((candidate) => {
          if (candidate.shape === "rect") {
            const halfTraceWidth = (point.width || 0) / 2
            return (
              Math.abs(point.x - candidate.x) <
                candidate.width / 2 + halfTraceWidth &&
              Math.abs(point.y - candidate.y) <
                candidate.height / 2 + halfTraceWidth
            )
          }
          if (candidate.shape === "circle") {
            return (
              Math.hypot(point.x - candidate.x, point.y - candidate.y) <
              candidate.radius
            )
          }
          // The converter's rotated pads only receive direct port annotations.
          return false
        })
        portId = pad?.pcb_port_id
      }
      if (!portId) continue
      if (needsStartPort) point.start_pcb_port_id = portId
      if (needsEndPort) point.end_pcb_port_id = portId
    }
  }
}
