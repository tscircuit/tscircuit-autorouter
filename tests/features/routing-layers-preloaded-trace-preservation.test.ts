import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/autorouting-pipeline-solver9-preloaded-trace-graph"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { routeUsesOnlyRoutingLayers } from "../helpers/route-uses-only-routing-layers"

test("preloaded copper on an excluded layer is preserved while new copper is constrained", () => {
  const preloadedTrace = {
    type: "pcb_trace",
    pcb_trace_id: "preloaded_inner1",
    connection_name: "preloaded_inner1",
    route: [
      {
        route_type: "wire",
        x: -4,
        y: 3,
        width: 0.15,
        layer: "inner1",
      },
      {
        route_type: "wire",
        x: 4,
        y: 3,
        width: 0.15,
        layer: "inner1",
      },
    ],
  } satisfies SimplifiedPcbTrace
  const input = {
    layerCount: 4,
    routingLayers: ["top", "bottom"],
    minTraceWidth: 0.15,
    minViaPadDiameter: 0.3,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    obstacles: [],
    connections: [
      {
        name: "new_outer_route",
        pointsToConnect: [
          { x: -3, y: 0, layer: "top" },
          { x: 3, y: 0, layer: "bottom" },
        ],
      },
    ],
    traces: [preloadedTrace],
  } satisfies SimpleRouteJson

  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  solver.solve()
  const output = solver.getOutputSimpleRouteJson()
  const preservedTrace = output.traces?.find(
    (trace) => trace.pcb_trace_id === preloadedTrace.pcb_trace_id,
  )
  const newTraces = output.traces?.filter(
    (trace) => trace.pcb_trace_id !== preloadedTrace.pcb_trace_id,
  )
  const allowedLayers = new Set(["top", "bottom"])

  expect(solver.failed).toBe(false)
  expect(preservedTrace).toEqual(preloadedTrace)
  expect(newTraces?.length).toBeGreaterThan(0)
  expect(
    newTraces?.every((trace) =>
      routeUsesOnlyRoutingLayers(trace, allowedLayers),
    ),
  ).toBe(true)
})
