import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"

test("Pipeline9 reports a width constraint instead of accepting a narrow shortcut", (): void => {
  const input: SimpleRouteJson = {
    bounds: { minX: -15, maxX: 15, minY: -10, maxY: 10 },
    layerCount: 1,
    minTraceWidth: 0.1,
    minTraceToPadEdgeClearance: 0.13,
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: -11.4, y: 0 },
        width: 0.8,
        height: 0.8,
        connectedTo: ["WIDE_POWER"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 11.4, y: 0 },
        width: 0.8,
        height: 0.8,
        connectedTo: ["WIDE_POWER"],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 1.425 },
        width: 20,
        height: 2.35,
        connectedTo: [],
      },
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: -1.425 },
        width: 20,
        height: 2.35,
        connectedTo: [],
      },
    ],
    connections: [
      {
        name: "WIDE_POWER",
        nominalTraceWidth: 0.4,
        minTraceWidth: 0.4,
        pointsToConnect: [
          { x: -11.4, y: 0, layer: "top", pointId: "left" },
          { x: 11.4, y: 0, layer: "top", pointId: "right" },
        ],
      },
    ],
  }

  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, {
    cacheProvider: null,
  })
  solver.solve()

  expect(solver.failed).toBe(true)
  expect(solver.error).toContain("minimum width of 0.4 mm")
})
