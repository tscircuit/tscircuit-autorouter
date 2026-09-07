import { expect, test } from "bun:test"
import type { PcbPlatedHole } from "circuit-json"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import type { Obstacle, SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

const makeHole = (id: string, x: number, y: number): Obstacle => ({
  type: "rect",
  center: { x, y },
  width: 1.3,
  height: 1.3,
  layers: ["top", "inner1", "inner2", "bottom"],
  connectedTo: [id, "pcb_port_4", "source_trace_0"],
  circuitJsonMetadata: {
    pcb_plated_hole_id: id,
    pcb_port_id: "pcb_port_4",
  },
})

test("distinct plated-hole geometry survives reused metadata IDs while duplicates and foreign copper remain checked", (): void => {
  const first = makeHole("pcb_plated_hole_4", -21, -4)
  const second: Obstacle = {
    ...makeHole("pcb_plated_hole_4", -17.5, -1),
    type: "rect",
    width: 1.7,
    height: 1.95,
  }
  const reserved = makeHole("pcb_plated_hole_4__geometry_1", 10, 4)
  const srj: SimpleRouteJson = {
    bounds: { minX: -25, maxX: 25, minY: -5, maxY: 5 },
    layerCount: 4,
    minTraceWidth: 0.15,
    obstacles: [first, second, structuredClone(second), reserved],
    connections: [{
      name: "source_trace_0",
      pointsToConnect: [
        { x: -21, y: -4, layer: "top" },
        { x: -17.5, y: -1, layer: "top" },
      ],
    }],
  }
  const trace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "trace_0",
    connection_name: "source_trace_0",
    route: [
      { route_type: "wire", x: -21, y: -4, width: 0.15, layer: "top" },
      { route_type: "wire", x: -17.5, y: -1, width: 0.15, layer: "top" },
    ],
  }
  const original = structuredClone({ srj, trace })
  const circuitJson = convertToCircuitJson(srj, [trace])
  const holes = circuitJson.filter((element): element is PcbPlatedHole => element.type === "pcb_plated_hole")
  expect(holes).toHaveLength(3)
  expect(new Set(holes.map((hole): string => hole.pcb_plated_hole_id)).size).toBe(3)
  expect(holes.map((hole): string => hole.pcb_plated_hole_id)).toEqual([
    "pcb_plated_hole_4",
    "pcb_plated_hole_4__geometry_2",
    "pcb_plated_hole_4__geometry_1",
  ])
  expect(holes[1]).toMatchObject({
    x: -17.5,
    y: -1,
    shape: "circular_hole_with_rect_pad",
    rect_pad_width: 1.7,
    rect_pad_height: 1.95,
    pcb_port_id: "pcb_port_4",
    layers: ["top", "inner1", "inner2", "bottom"],
  })
  expect(getDrcErrors(circuitJson).errors).toHaveLength(0)
  const foreignTrace: SimplifiedPcbTrace = {
    ...trace,
    pcb_trace_id: "foreign_trace",
    connection_name: "foreign_net",
    route: [
      { route_type: "wire", x: -18.1, y: -1, width: 0.15, layer: "top" },
      { route_type: "wire", x: -16.9, y: -1, width: 0.15, layer: "top" },
    ],
  }
  const foreignErrors = getDrcErrors(convertToCircuitJson(srj, [foreignTrace])).errors
  expect(foreignErrors.some((error): boolean =>
    error.type === "pcb_trace_error" &&
    error.pcb_trace_id === "foreign_trace" &&
    String(error.pcb_trace_error_id).includes("pcb_plated_hole_4__geometry_2"),
  )).toBeTrue()
  expect({ srj, trace }).toEqual(original)
})
