import { expect, test } from "bun:test"
import { AssignableAutoroutingPipeline3 } from "lib/autorouter-pipelines/AssignableAutoroutingPipeline3/AssignableAutoroutingPipeline3"
import type { SimpleRouteJson } from "lib/types"

test("AssignablePipeline3 fails clearly before placing a jumper on an excluded top layer", () => {
  const input = {
    layerCount: 2,
    routingLayers: ["bottom"],
    minTraceWidth: 0.1,
    minViaPadDiameter: 0.3,
    bounds: { minX: -1.05, maxX: 1.05, minY: -1.05, maxY: 1.05 },
    obstacles: [],
    connections: [
      {
        name: "horizontal",
        pointsToConnect: [
          { x: -1, y: 0, layer: "bottom" },
          { x: 1, y: 0, layer: "bottom" },
        ],
      },
      {
        name: "vertical",
        pointsToConnect: [
          { x: 0, y: -1, layer: "bottom" },
          { x: 0, y: 1, layer: "bottom" },
        ],
      },
    ],
  } satisfies SimpleRouteJson
  const solver = new AssignableAutoroutingPipeline3(input, {
    cacheProvider: null,
    effort: 0.1,
  })

  expect(() => solver.solve()).toThrow(
    'AssignablePipeline3 cannot place top-layer jumpers because routingLayers excludes "top"',
  )
})
