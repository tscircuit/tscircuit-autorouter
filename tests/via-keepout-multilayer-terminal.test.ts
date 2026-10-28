import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline } from "../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "../lib/types"

test("a multilayer terminal retains its legal bottom route when all new vias are forbidden", () => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaDiameter: 0.6,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    obstacles: [],
    connections: [
      {
        name: "net",
        pointsToConnect: [
          { x: -3, y: 0, layers: ["top", "bottom"] },
          { x: 3, y: 0, layer: "bottom" },
        ],
      },
    ],
    viaKeepouts: [
      {
        shape: "rect",
        center: { x: 0, y: 0 },
        width: 10,
        height: 10,
        layers: ["top", "bottom"],
      },
    ],
  }
  for (const fixedLayer of ["top", "bottom"]) {
    for (const reverse of [false, true]) {
      const points = [
        {
          x: -3,
          y: 0,
          layers:
            fixedLayer === "bottom" ? ["top", "bottom"] : ["bottom", "top"],
        },
        { x: 3, y: 0, layer: fixedLayer },
      ]
      const solver = new Pipeline({
        ...srj,
        connections: [
          {
            name: "net",
            pointsToConnect: reverse ? [...points].reverse() : points,
          },
        ],
      })
      solver.solve()
      expect(solver.failed).toBe(false)
      const traces = solver.getOutputSimplifiedPcbTraces()
      expect(traces).toHaveLength(1)
      expect(
        traces[0].route.filter((p) => p.route_type === "via"),
      ).toHaveLength(0)
      expect(
        traces[0].route
          .filter((p) => p.route_type === "wire")
          .every((p) => p.layer === fixedLayer),
      ).toBe(true)
    }
  }
})
