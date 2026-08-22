import { expect, test } from "bun:test"
import type { PreloadedHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convert-preloaded-traces-to-hd-routes"
import { preparePipeline9MutatedPreloadedSections } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9-mutated-preloaded-trace-simplification"

test("Pipeline9 keeps jumper-bearing mutation routes immutable", () => {
  const route: PreloadedHighDensityRoute = {
    connectionName: "fixed_with_jumper",
    rootConnectionName: "net",
    preloadedTraceIndex: 0,
    preloadedRouteIndex: 0,
    preloadedRoutePositionStart: 0,
    preloadedRoutePositionEnd: 2,
    traceThickness: 0.15,
    viaDiameter: 0.5,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0, insideJumperPad: true },
      { x: 2, y: 0, z: 0, insideJumperPad: true },
    ],
    vias: [],
    jumpers: [
      {
        route_type: "jumper",
        start: { x: 1, y: 0 },
        end: { x: 2, y: 0 },
        footprint: "0603",
      },
    ],
  }
  const prepared = preparePipeline9MutatedPreloadedSections({
    updatedFixedRoutes: [route],
    regionalMutationMasks: new Map([[route.connectionName, [true, true]]]),
  })

  expect(prepared.sections).toEqual([])
  expect(prepared.normalizedFixedRoutes).toEqual([route])
  expect(prepared.immutableHdRoutes).toEqual([route])
})
