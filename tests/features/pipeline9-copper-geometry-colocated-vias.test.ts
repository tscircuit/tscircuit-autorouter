import { expect, test } from "bun:test"
import { materializePipeline9HdRouteVias } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/materializePipeline9HdRouteVias"
import { getPipeline9RouteCopperGeometry } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("Pipeline9 keeps colocated layer transitions without requiring explicit vias", (): void => {
  for (const vias of [[], [{ x: 1, y: 2 }]]) {
    const hdRoute: HighDensityRoute = {
      connectionName: "colocated-transition",
      traceThickness: 0.2,
      viaDiameter: 0.55,
      route: [
        { x: 1, y: 2, z: 2 },
        { x: 1, y: 2, z: 0 },
      ],
      vias,
    }
    expect(getPipeline9RouteCopperGeometry(hdRoute)).toEqual({
      wireSegments: [],
      viaSpans: [
        {
          center: { x: 1, y: 2 },
          minZ: 0,
          maxZ: 2,
          diameter: 0.55,
        },
      ],
    })
    expect(materializePipeline9HdRouteVias([hdRoute])[0]!.route).toEqual(
      hdRoute.route,
    )
  }

  const sameLayerRoute: HighDensityRoute = {
    connectionName: "same-layer-wire",
    traceThickness: 0.2,
    viaDiameter: 0.55,
    route: [
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 2, z: 1 },
    ],
    vias: [],
  }
  const geometry = getPipeline9RouteCopperGeometry(sameLayerRoute)
  expect(geometry.viaSpans).toEqual([])
  expect(geometry.wireSegments).toEqual([
    {
      start: sameLayerRoute.route[0],
      end: sameLayerRoute.route[1],
      z: 1,
      width: 0.2,
    },
  ])
})
