import { expect, test } from "bun:test"
import { checkTraceContinuity } from "lib/utils/autorouting-drc/checkTraceContinuity"
import { convertToCircuitJson } from "lib/utils/convertToCircuitJson"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("port and via ownership IDs cannot bridge disconnected pieces of copper", () => {
  const points = [0, 4].map((x) => ({
    x,
    y: 0,
    layer: "top",
    pcb_port_id: `port-${x}`,
  }))
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -1, maxX: 5, minY: -1, maxY: 1 },
    connections: [{ name: "signal", pointsToConnect: points }],
    obstacles: points.map((point) => ({
      type: "rect",
      width: 0.4,
      height: 0.4,
      center: point,
      layers: ["top"],
      connectedTo: [point.pcb_port_id],
      circuitJsonMetadata: {
        pcb_smtpad_id: `pad-${point.x}`,
        pcb_port_id: point.pcb_port_id,
      },
    })),
  }
  function wire(id: string, a: number, b: number): SimplifiedPcbTrace {
    return {
      type: "pcb_trace",
      pcb_trace_id: id,
      connection_name: "signal",
      route: [a, b].map((x) => ({
        x,
        y: 0,
        layer: "top",
        width: 0.1,
        route_type: "wire",
      })),
    }
  }
  const circuit = convertToCircuitJson(srj, [
    wire("left", 0, 1),
    wire("right", 3, 4),
  ])
  const left = circuit.find(
    (e) => e.type === "pcb_trace" && e.pcb_trace_id === "left",
  )
  if (left?.type !== "pcb_trace" || left.route[1]?.route_type !== "wire")
    throw new Error("Missing left wire")
  const missing = () =>
    checkTraceContinuity(circuit).map((e) => e.pcb_trace_error_id)
  expect(missing()).toContain("missing_connection_left_port-4")
  left.route[1].end_pcb_port_id = "port-4"
  expect(missing()).toContain("missing_connection_left_port-4")
  delete left.route[1].end_pcb_port_id
  circuit.push({
    type: "pcb_via",
    pcb_via_id: "via-on-right",
    pcb_trace_id: "left",
    x: 3,
    y: 0,
    outer_diameter: 0.4,
    hole_diameter: 0.2,
    layers: ["top", "bottom"],
  })
  expect(missing()).toContain("missing_connection_left_port-4")
  left.route[1].x = 3
  expect(missing()).toEqual([])
})
