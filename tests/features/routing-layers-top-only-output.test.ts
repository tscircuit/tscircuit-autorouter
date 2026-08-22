import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver7_MultiGraph } from "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/AutoroutingPipelineSolver7_MultiGraph"
import type { SimpleRouteJson } from "lib/types"

test("a top-only four-layer route generates copper only on top", () => {
  const input = {
    layerCount: 4,
    routingLayers: ["top"],
    minTraceWidth: 0.15,
    minViaPadDiameter: 0.3,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    obstacles: [],
    connections: [
      {
        name: "top-only",
        pointsToConnect: [
          { x: -3, y: 0, layer: "top" },
          { x: 3, y: 0, layer: "top" },
        ],
      },
    ],
  } satisfies SimpleRouteJson

  const solver = new AutoroutingPipelineSolver7_MultiGraph(input)
  solver.solve()
  const output = solver.getOutputSimpleRouteJson()
  const route = output.traces?.[0]?.route ?? []

  expect(solver.failed).toBe(false)
  expect(route.length).toBeGreaterThan(0)
  expect(
    route.every(
      (segment) => segment.route_type !== "wire" || segment.layer === "top",
    ),
  ).toBe(true)
  expect(route.some((segment) => segment.route_type === "via")).toBe(false)
})
