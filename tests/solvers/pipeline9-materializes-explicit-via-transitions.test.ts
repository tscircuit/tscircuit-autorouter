import { expect, test } from "bun:test"
import { materializePipeline9HdRouteVias } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/materializePipeline9HdRouteVias"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("materializes a diagonal layer transition at its explicit via", (): void => {
  const inputRoute: HighDensityRoute = {
    connectionName: "signal",
    traceThickness: 0.15,
    viaDiameter: 0.6,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 1, z: 1 },
      { x: 3, y: 1, z: 1 },
    ],
    vias: [{ x: 2, y: 1 }],
  }

  const [materializedRoute] = materializePipeline9HdRouteVias([inputRoute])

  expect(materializedRoute.route).toEqual([
    { x: 0, y: 0, z: 0 },
    { x: 2, y: 1, z: 0 },
    { x: 2, y: 1, z: 1 },
    { x: 3, y: 1, z: 1 },
  ])
  expect(materializedRoute.vias).toEqual(inputRoute.vias)
})
