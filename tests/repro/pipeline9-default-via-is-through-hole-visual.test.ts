import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getDrcErrors } from "lib/testing/getDrcErrors"

test("Pipeline9 records its preloaded default-via routing diagnostic", (): void => {
  const inputSrj: SimpleRouteJson = {
    layerCount: 4,
    minTraceWidth: 0.1,
    minViaPadDiameter: 0.45,
    minViaHoleDiameter: 0.3,
    minTraceToPadEdgeClearance: 0.25,
    bounds: { minX: -4, maxX: 4, minY: -2, maxY: 2 },
    obstacles: [],
    connections: [
      {
        name: "bottom-trace",
        pointsToConnect: [
          { x: -3, y: 0, layer: "bottom", pointId: "left" },
          { x: 3, y: 0, layer: "bottom", pointId: "right" },
        ],
      },
    ],
    traces: [
      {
        type: "pcb_trace",
        pcb_trace_id: "preloaded-transition",
        connection_name: "preloaded-transition",
        route: [
          { route_type: "wire", x: 0, y: -1, width: 0.1, layer: "top" },
          {
            route_type: "via",
            x: 0,
            y: 0,
            from_layer: "top",
            to_layer: "inner2",
            via_diameter: 0.45,
            via_hole_diameter: 0.3,
          },
          {
            route_type: "wire",
            x: 0,
            y: 1,
            width: 0.1,
            layer: "inner2",
          },
        ],
      },
    ],
  }
  const original = structuredClone(inputSrj)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
    cacheProvider: null,
    effort: 0.1,
  })

  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(inputSrj).toEqual(original)
  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  const replacement = routedTraces.find(
    (trace) => trace.__replaces_pcb_trace_id === "preloaded-transition",
  )!
  expect(solver.getMutatedPreloadedTraces()).toHaveLength(1)
  expect(replacement.route[0]).toMatchObject({
    x: 0,
    y: -1,
    layer: "top",
  })
  expect(replacement.route.at(-1)).toMatchObject({
    x: 0,
    y: 1,
    layer: "inner2",
  })
  // Correct HD copper exposes an existing Pipeline9 replacement: the via moves
  // from (0,0) to (0,1), with the lateral preload now routed on TOP.
  expect(replacement.route.filter((point) => point.route_type === "via")).toEqual([
    {
      route_type: "via",
      x: 0,
      y: 1,
      from_layer: "top",
      to_layer: "inner2",
      via_diameter: 0.45,
      via_hole_diameter: 0.3,
    },
  ])
  const layerNames = ["top", "inner1", "inner2", "bottom"]
  expect(
    routedTraces.every((trace) =>
      trace.route.every((point) =>
        point.route_type === "wire"
          ? layerNames.includes(point.layer)
          : point.route_type === "via" &&
            layerNames.includes(point.from_layer) &&
            layerNames.includes(point.to_layer),
      ),
    ),
  ).toBeTrue()
  const bottom = routedTraces.find(
    (trace) => trace.connection_name === "bottom-trace",
  )!
  expect(bottom.route[0]).toMatchObject({ x: -3, y: 0, layer: "bottom" })
  expect(bottom.route.at(-1)).toMatchObject({ x: 3, y: 0, layer: "bottom" })

  const control = structuredClone(inputSrj)
  const controlRoute = control.traces![0]!.route
  controlRoute.splice(1, 0, {
    route_type: "wire",
    x: 0,
    y: 0,
    width: 0.1,
    layer: "top",
  })
  controlRoute.splice(3, 0, {
    route_type: "wire",
    x: 0,
    y: 0,
    width: 0.1,
    layer: "inner2",
  })
  const controlSolver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    control,
    { cacheProvider: null, effort: 0.1 },
  )
  controlSolver.solve()
  expect(controlSolver.solved).toBeTrue()
  expect(controlSolver.getOutputSimplifiedPcbTraces()).toEqual(routedTraces)

  const evaluation = evaluateRelaxedDrc({
    inputSrj,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces,
  })
  // This existing reduced fixture has no pads. Keep its four actual disconnected
  // endpoint reports visible; solved is not a claim that the board passes DRC.
  const full = getDrcErrors(evaluation.circuitJson)
  expect(full.errors).toEqual(evaluation.errors)
  expect(
    full.errors.map((error) =>
      error.type === "pcb_trace_error" ? error.pcb_trace_error_id : error.type,
    ),
  ).toEqual([
    "disconnected_endpoint_preloaded-transition_start",
    "disconnected_endpoint_preloaded-transition_end",
    "disconnected_endpoint_bottom-trace_0_start",
    "disconnected_endpoint_bottom-trace_0_end",
  ])
  expect(
    evaluation.circuitJson.filter((element) => element.type === "pcb_via"),
  ).toEqual([
    expect.objectContaining({
      x: 0,
      y: 1,
      pcb_trace_id: "preloaded-transition",
      layers: layerNames,
    }),
  ])
  expect(
    getBugReportSnapshotSvg({
      inputSrj,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
