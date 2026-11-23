import { expect, test } from "bun:test"
import { createPipeline9AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9AutoroutingDrcEvaluator"
import type { SimpleRouteJson } from "lib/types"

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
  function errorsAt(x: number, y: number, layer: string) {
    return check(
      [
        {
          type: "pcb_trace",
          pcb_trace_id: "wire",
          connection_name: "signal",
          route: [
            { route_type: "wire", x: -2, y: 0, layer: "top", width: 0.1 },
            { route_type: "wire", x, y, layer, width: 0.1 },
          ],
        },
      ],
      { includeTraceContinuity: true },
    ).errors.map((e) => e.pcb_trace_error_id)
  }
  expect(errorsAt(2, 0, "top")).toEqual([])
  expect(errorsAt(2, 0, "bottom")).toContain("disconnected_endpoint_wire_end")
  expect(errorsAt(2, 1, "top")).toContain("disconnected_endpoint_wire_end")
  expect(errorsAt(1, 0, "top")).toContain("disconnected_endpoint_wire_end")
})
