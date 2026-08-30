import { expect, test } from "bun:test"
import type { PreloadedHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import { preparePipeline9MutatedPreloadedSections } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9MutatedPreloadedTraceSimplification"

test("Pipeline9 does not join mutation runs across an immutable loop", () => {
  const route: PreloadedHighDensityRoute = {
    connectionName: "loop",
    rootConnectionName: "net",
    preloadedTraceIndex: 0,
    preloadedRouteIndex: 0,
    preloadedRoutePositionStart: 1,
    preloadedRoutePositionEnd: 1,
    traceThickness: 0.15,
    viaDiameter: 0.5,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 3, y: 0, z: 0 },
    ],
    vias: [],
  }
  const prepared = preparePipeline9MutatedPreloadedSections({
    updatedFixedRoutes: [route],
    regionalMutationMasks: new Map([
      [route.connectionName, [true, false, false, true]],
    ]),
  })

  expect(prepared.sections).toHaveLength(2)
  expect(
    prepared.sections.map((section) =>
      section.hdRoute.route.map((point) => point.x),
    ),
  ).toEqual([
    [0, 1],
    [1, 3],
  ])
  expect(
    prepared.immutableHdRoutes.map((immutableRoute) =>
      immutableRoute.route.map((point) => point.x),
    ),
  ).toEqual([[1, 2, 1]])
})
