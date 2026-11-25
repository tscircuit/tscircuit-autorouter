import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import type { SimpleRouteJson } from "lib/types"

test("routes explicit width paths and a tap on the same net", async (): Promise<void> => {
  const a = { pointId: "A", x: -5, y: 0, layer: "top" }
  const b = { pointId: "B", x: 5, y: 0, layer: "top" }
  const c = { pointId: "C", x: 0, y: 2, layer: "top" }
  const d = { pointId: "D", x: 0, y: 4, layer: "top" }
  const input: SimpleRouteJson = {
    bounds: { minX: -7, maxX: 7, minY: -2, maxY: 6 },
    layerCount: 2,
    minTraceWidth: 0.15,
    obstacles: [a, b, c, d].map(({ x, y, pointId }) => ({
      type: "rect",
      center: { x, y },
      width: 1,
      height: 1,
      layers: ["top"],
      connectedTo: [pointId],
    })),
    connections: [
      {
        name: "supply",
        pointsToConnect: [a, b],
        path: ["A", "B"],
        nominalTraceWidth: 0.8,
      },
      {
        name: "sense",
        pointsToConnect: [b, c],
        path: ["B", "C"],
        nominalTraceWidth: 0.25,
      },
      { name: "VCC", pointsToConnect: [a, d], nominalTraceWidth: 0.2 },
    ],
  }
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  solver.solve()
  expect(solver.solved, solver.error ?? "").toBe(true)
  const traces = solver.getOutputSimplifiedPcbTraces()
  const wires = traces
    .map((trace) => {
      const pads = [...trace.connectsTo!].sort().join("–")
      const widths = new Set(
        trace.route.flatMap((point) =>
          point.route_type === "wire" ? [point.width] : [],
        ),
      )
      return `${pads} · ${[...widths].join(", ")} mm`
    })
    .sort()
  expect(wires).toMatchInlineSnapshot(`
    [
      "A–B · 0.8 mm",
      "B–C · 0.8 mm",
      "C–D · 0.8 mm",
    ]
  `)
  await expect(
    getBugReportSnapshotSvg({
      inputSrj: input,
      srjWithPointPairs: solver.srjWithPointPairs!,
      routedTraces: traces,
    }),
  ).toMatchSvgSnapshot(import.meta.path)
})
