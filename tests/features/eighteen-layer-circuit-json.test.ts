import { expect, test } from "bun:test"
import { createPipeline9AutoroutingDrcEvaluator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9AutoroutingDrcEvaluator"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"

test("continuity sees the wires and via on an 18-layer board", () => {
  const srj: SimpleRouteJson = {
    layerCount: 18,
    bounds: { minX: -3, maxX: 3, minY: -2, maxY: 2 },
    minTraceWidth: 0.1,
    obstacles: [],
    connections: [
      {
        name: "signal",
        pointsToConnect: [
          { x: -2, y: 0, layer: "inner9", pointId: "a" },
          { x: 2, y: 0, layer: "inner16", pointId: "b" },
        ],
      },
    ],
  }
  const route: SimplifiedPcbTrace["route"] = [
    { route_type: "wire", x: -2, y: 0, width: 0.1, layer: "inner9" },
    { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "inner9" },
    {
      route_type: "via",
      x: 0,
      y: 0,
      from_layer: "inner9",
      to_layer: "inner16",
    },
    { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "inner16" },
    { route_type: "wire", x: 2, y: 0, width: 0.1, layer: "inner16" },
  ]
  const check = createPipeline9AutoroutingDrcEvaluator({
    inputSrj: srj,
    srjWithPointPairs: srj,
  })
  const trace: SimplifiedPcbTrace = {
    type: "pcb_trace",
    pcb_trace_id: "route",
    connection_name: "signal",
    route,
  }
  const { circuitJson, errors } = check([trace])
  expect(circuitJson.find((e) => e.type === "pcb_trace")?.route).toMatchObject(
    route,
  )
  expect(circuitJson.find((e) => e.type === "pcb_via")?.layers).toContain(
    "inner16",
  )
  expect(errors).toEqual([])
  expect(
    check([{ ...trace, route: route.slice(0, 2) }]).errors.map(
      (e) => e.pcb_trace_error_id,
    ),
  ).toContain("missing_connection_route_b")
})
