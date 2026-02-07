import type { ConnectionPoint, SimplifiedPcbTraces } from "lib/types"

/**
 * Adds start_pcb_port_id and end_pcb_port_id to the first and last wire
 * segments of a route based on the connection's pointsToConnect.
 *
 * This is critical for downstream tools (like DRC checks) that need to
 * build connectivity maps to determine which traces connect to which ports.
 */
export const addPortIdsToRoute = (
  route: SimplifiedPcbTraces[number]["route"],
  pointsToConnect: ConnectionPoint[],
): void => {
  if (route.length === 0 || pointsToConnect.length < 2) return

  const startPortId = pointsToConnect[0]?.pcb_port_id
  const endPortId = pointsToConnect[1]?.pcb_port_id

  // Find first wire segment and add start_pcb_port_id
  if (startPortId) {
    const firstWireIndex = route.findIndex((s) => s.route_type === "wire")
    if (firstWireIndex !== -1) {
      const segment = route[firstWireIndex]
      if (segment.route_type === "wire") {
        segment.start_pcb_port_id = startPortId
      }
    }
  }

  // Find last wire segment and add end_pcb_port_id
  if (endPortId) {
    let lastWireIndex = -1
    for (let i = route.length - 1; i >= 0; i--) {
      if (route[i].route_type === "wire") {
        lastWireIndex = i
        break
      }
    }
    if (lastWireIndex !== -1) {
      const segment = route[lastWireIndex]
      if (segment.route_type === "wire") {
        segment.end_pcb_port_id = endPortId
      }
    }
  }
}
