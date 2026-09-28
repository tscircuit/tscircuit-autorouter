import { expect, test } from "bun:test"
import { materializePipeline9HdRouteVias } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/materializePipeline9HdRouteVias"
import { getPipeline9RouteCopperGeometry } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("Pipeline9 geometry and materialization share per-axis endpoint tolerance", (): void => {
  for (const offset of [0.75e-6, 1e-6]) {
    const hdRoute: HighDensityRoute = {
      connectionName: "endpoint-tolerance",
      traceThickness: 0.15,
      viaDiameter: 0.55,
      route: [
        { x: 0, y: 0, z: 0 },
        { x: 2, y: 1, z: 1 },
      ],
      vias: [{ x: offset, y: -offset }],
    }
    const geometry = getPipeline9RouteCopperGeometry(hdRoute)
    expect(geometry.viaSpans[0]!.center).toEqual({ x: 0, y: 0 })
    expect(geometry.wireSegments[0]!.z).toBe(1)
    expect(
      getPipeline9RouteCopperGeometry(
        materializePipeline9HdRouteVias([hdRoute])[0]!,
      ),
    ).toEqual(geometry)
  }

  const nearColocatedRoute: HighDensityRoute = {
    connectionName: "near-colocated-transition",
    traceThickness: 0.15,
    viaDiameter: 0.55,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 0.75e-6, y: 0.75e-6, z: 1 },
    ],
    vias: [],
  }
  expect(
    materializePipeline9HdRouteVias([nearColocatedRoute])[0]!.route,
  ).toEqual(nearColocatedRoute.route)
  expect(
    getPipeline9RouteCopperGeometry(nearColocatedRoute).viaSpans[0]!.center,
  ).toEqual({ x: 0.75e-6, y: 0.75e-6 })

  const outsideToleranceRoute: HighDensityRoute = {
    ...nearColocatedRoute,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 1, z: 1 },
    ],
    vias: [{ x: 1.01e-6, y: 0 }],
  }
  expect(() => getPipeline9RouteCopperGeometry(outsideToleranceRoute)).toThrow(
    "without an explicit via",
  )
  expect(() =>
    materializePipeline9HdRouteVias([outsideToleranceRoute]),
  ).toThrow("without an explicit via")
})
