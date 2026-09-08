import { expect, test } from "bun:test"
import { materializePipeline9HdRouteVias } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/materializePipeline9HdRouteVias"
import { getPipeline9RouteCopperGeometry } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("Pipeline9 endpoint resolution leaves through-obstacle copper unchanged", (): void => {
  const hdRoute: HighDensityRoute = {
    connectionName: "plated-hole-transition",
    traceThickness: 0.15,
    viaDiameter: 0.55,
    route: [
      {
        x: 0,
        y: 0,
        z: 0,
        traceThickness: 0.35,
        toNextSegmentType: "through_obstacle",
        toNextSegmentCircuitJsonMetadata: { pcb_plated_hole_id: "plated-hole" },
      },
      { x: 2, y: 1, z: 2, traceThickness: 0.7 },
    ],
    vias: [],
  }
  const originalRoute = structuredClone(hdRoute)
  const geometry = getPipeline9RouteCopperGeometry(hdRoute)
  expect(geometry.viaSpans).toEqual([])
  expect(geometry.wireSegments).toEqual(
    [0, 1, 2].map((z) => ({
      start: { ...hdRoute.route[0], z },
      end: { ...hdRoute.route[1], z },
      z,
      width: 0.7,
    })),
  )
  expect(materializePipeline9HdRouteVias([hdRoute])[0]!.route).toEqual(
    hdRoute.route,
  )
  expect(hdRoute).toEqual(originalRoute)

  for (const explicitVia of [false, true]) {
    const colocatedRoute: HighDensityRoute = {
      ...hdRoute,
      route: [hdRoute.route[0]!, { x: 0, y: 0, z: 2, traceThickness: 0.7 }],
      vias: explicitVia ? [{ x: 0, y: 0 }] : [],
    }
    expect(getPipeline9RouteCopperGeometry(colocatedRoute)).toEqual({
      wireSegments: [],
      viaSpans: [
        {
          center: { x: 0, y: 0 },
          minZ: 0,
          maxZ: 2,
          diameter: explicitVia ? 0.55 : 0.7,
        },
      ],
    })
    expect(materializePipeline9HdRouteVias([colocatedRoute])[0]!.route).toEqual(
      colocatedRoute.route,
    )
  }
})
