import { describe, expect, test } from "bun:test"
import type { ConnectionPoint, SimplifiedPcbTraces } from "../../lib/types"
import { addPortIdsToRoute } from "../../lib/utils/addPortIdsToRoute"

describe("addPortIdsToRoute", () => {
  test("adds start_pcb_port_id to first wire segment and end_pcb_port_id to last wire segment", () => {
    const route: SimplifiedPcbTraces[number]["route"] = [
      { route_type: "wire", x: 0, y: 0, width: 0.2, layer: "top" },
      { route_type: "wire", x: 1, y: 0, width: 0.2, layer: "top" },
      { route_type: "wire", x: 2, y: 0, width: 0.2, layer: "top" },
    ]

    const pointsToConnect: ConnectionPoint[] = [
      { x: 0, y: 0, layer: "top", pcb_port_id: "pcb_port_0" },
      { x: 2, y: 0, layer: "top", pcb_port_id: "pcb_port_1" },
    ]

    addPortIdsToRoute(route, pointsToConnect)

    expect(route[0]).toHaveProperty("start_pcb_port_id", "pcb_port_0")
    expect(route[0]).not.toHaveProperty("end_pcb_port_id")
    expect(route[1]).not.toHaveProperty("start_pcb_port_id")
    expect(route[1]).not.toHaveProperty("end_pcb_port_id")
    expect(route[2]).toHaveProperty("end_pcb_port_id", "pcb_port_1")
    expect(route[2]).not.toHaveProperty("start_pcb_port_id")
  })

  test("handles routes with vias - finds correct first and last wire segments", () => {
    const route: SimplifiedPcbTraces[number]["route"] = [
      { route_type: "wire", x: 0, y: 0, width: 0.2, layer: "top" },
      { route_type: "wire", x: 1, y: 0, width: 0.2, layer: "top" },
      { route_type: "via", x: 1, y: 0, from_layer: "top", to_layer: "bottom" },
      { route_type: "wire", x: 1, y: 0, width: 0.2, layer: "bottom" },
      { route_type: "wire", x: 2, y: 0, width: 0.2, layer: "bottom" },
    ]

    const pointsToConnect: ConnectionPoint[] = [
      { x: 0, y: 0, layer: "top", pcb_port_id: "pcb_port_5" },
      { x: 2, y: 0, layer: "bottom", pcb_port_id: "pcb_port_6" },
    ]

    addPortIdsToRoute(route, pointsToConnect)

    // First wire segment should have start_pcb_port_id
    expect(route[0]).toHaveProperty("start_pcb_port_id", "pcb_port_5")
    // Last wire segment should have end_pcb_port_id
    expect(route[4]).toHaveProperty("end_pcb_port_id", "pcb_port_6")
    // Via should not have port IDs
    expect(route[2]).not.toHaveProperty("start_pcb_port_id")
    expect(route[2]).not.toHaveProperty("end_pcb_port_id")
  })

  test("handles empty route gracefully", () => {
    const route: SimplifiedPcbTraces[number]["route"] = []
    const pointsToConnect: ConnectionPoint[] = [
      { x: 0, y: 0, layer: "top", pcb_port_id: "pcb_port_0" },
      { x: 2, y: 0, layer: "top", pcb_port_id: "pcb_port_1" },
    ]

    // Should not throw
    addPortIdsToRoute(route, pointsToConnect)
    expect(route.length).toBe(0)
  })

  test("handles missing pcb_port_id gracefully", () => {
    const route: SimplifiedPcbTraces[number]["route"] = [
      { route_type: "wire", x: 0, y: 0, width: 0.2, layer: "top" },
      { route_type: "wire", x: 2, y: 0, width: 0.2, layer: "top" },
    ]

    const pointsToConnect: ConnectionPoint[] = [
      { x: 0, y: 0, layer: "top" }, // No pcb_port_id
      { x: 2, y: 0, layer: "top", pcb_port_id: "pcb_port_1" },
    ]

    addPortIdsToRoute(route, pointsToConnect)

    // First segment should not have start_pcb_port_id since it was undefined
    expect(route[0]).not.toHaveProperty("start_pcb_port_id")
    // Last segment should still have end_pcb_port_id
    expect(route[1]).toHaveProperty("end_pcb_port_id", "pcb_port_1")
  })

  test("handles single wire segment", () => {
    const route: SimplifiedPcbTraces[number]["route"] = [
      { route_type: "wire", x: 0, y: 0, width: 0.2, layer: "top" },
    ]

    const pointsToConnect: ConnectionPoint[] = [
      { x: 0, y: 0, layer: "top", pcb_port_id: "pcb_port_0" },
      { x: 0, y: 0, layer: "top", pcb_port_id: "pcb_port_1" },
    ]

    addPortIdsToRoute(route, pointsToConnect)

    // Single segment should have both start and end port IDs
    expect(route[0]).toHaveProperty("start_pcb_port_id", "pcb_port_0")
    expect(route[0]).toHaveProperty("end_pcb_port_id", "pcb_port_1")
  })
})
