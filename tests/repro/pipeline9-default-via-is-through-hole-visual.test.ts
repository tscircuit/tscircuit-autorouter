import { pointToSegmentDistance } from "@tscircuit/math-utils"
import { getPreloadedTracePrimitives } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPreloadedTracePrimitives"
import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"

test("Pipeline9 routes across a preloaded default via's missing bottom obstacle", (): void => {
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
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
    cacheProvider: null,
    effort: 0.1,
  })

  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  // Both lengths of saved wire terminate at the via, even in compact SRJ
  // which only stores one wire coordinate on either side of the transition.
  const wires = getPreloadedTracePrimitives(inputSrj).filter(
    (primitive) => primitive.routePositionStart !== primitive.routePositionEnd,
  )
  expect(
    wires.map(({ start, end, zLayers }) => [start.y, end.y, zLayers]),
  ).toEqual([
    [-1, 0, [0]],
    [0, 1, [2]],
  ])
  const bottomTrace = solver
    .getOutputSimplifiedPcbTraces()
    .find((trace) => trace.connection_name === "bottom-trace")!
  const bottomWires = bottomTrace.route.filter(
    (point) => point.route_type === "wire",
  )
  expect(bottomWires.length).toBeGreaterThan(1)
  for (let i = 1; i < bottomWires.length; i++) {
    const a = bottomWires[i - 1]!,
      b = bottomWires[i]!
    const copperGap =
      pointToSegmentDistance({ x: 0, y: 0 }, a, b) -
      (Math.max(a.width, b.width) + inputSrj.minViaPadDiameter!) / 2
    expect(copperGap).toBeGreaterThanOrEqual(
      inputSrj.minTraceToPadEdgeClearance! - 1e-7,
    )
  }
  expect(
    getBugReportSnapshotSvg({
      inputSrj,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces: solver.getOutputSimplifiedPcbTraces(),
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
