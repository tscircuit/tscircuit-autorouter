import { expect, test } from "bun:test"
import { createPipeline9AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9AutoroutingDrcEvaluator"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("a padless endpoint must reach the declared position and layer of its own connection", () => {
  const input: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.1,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    obstacles: [],
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: -2, y: 0, layer: "top", pointId: "a" },
          { x: 2, y: 0, layer: "top", pointId: "b" },
        ],
      },
      {
        name: "other",
        pointsToConnect: [{ x: 2, y: 1, layer: "top", pointId: "c" }],
      },
    ],
  }
  const check = createPipeline9AutoroutingDrcEvaluator({
    inputSrj: input,
    srjWithPointPairs: input,
  })
  function wire(
    id: string,
    fromX: number,
    toX: number,
    y = 0,
    layer = "top",
  ): SimplifiedPcbTrace {
    return {
      type: "pcb_trace",
      pcb_trace_id: id,
      connection_name: "signal",
      route: [
        { route_type: "wire", x: fromX, y: 0, layer: "top", width: 0.1 },
        { route_type: "wire", x: toX, y, layer, width: 0.1 },
      ],
    }
  }
  function errorsAt(x: number, y: number, layer: string) {
    return check([wire("wire", -2, x, y, layer)]).errors.map(
      (e) => e.pcb_trace_error_id,
    )
  }
  const split = [wire("left", -2, -1), wire("right", 1, 2)]
  expect(check(split).errors.map((e) => e.pcb_trace_error_id)).toContain(
    "missing_connection_left_b",
  )
  expect(check([...split, wire("middle", -1, 1)]).errors).toEqual([])
  // Both wire ends touch a, leaving b completely untouched.
  expect(errorsAt(-2, 0, "top")).toContain("missing_connection_wire_b")
  expect(errorsAt(2, 0, "top")).toEqual([])
  expect(errorsAt(2, 0, "bottom")).toContain("disconnected_endpoint_wire_end")
  expect(errorsAt(2, 1, "top")).toContain("disconnected_endpoint_wire_end")
  expect(errorsAt(1, 0, "top")).toContain("disconnected_endpoint_wire_end")
})
