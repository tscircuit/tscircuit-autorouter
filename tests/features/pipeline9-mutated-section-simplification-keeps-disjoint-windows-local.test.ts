import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { PreloadedHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import {
  applyPipeline9MutatedPreloadedSections,
  preparePipeline9MutatedPreloadedSections,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9MutatedPreloadedTraceSimplification"
import { TraceSimplificationSolver } from "lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver"

test("Pipeline9 keeps distant mutation windows on one route separate", () => {
  const route: PreloadedHighDensityRoute = {
    connectionName: "fixed",
    rootConnectionName: "net",
    preloadedTraceIndex: 0,
    preloadedRouteIndex: 0,
    preloadedRoutePositionStart: 0,
    preloadedRoutePositionEnd: 8,
    traceThickness: 0.15,
    viaDiameter: 0.5,
    route: [0, 1, 3, 5, 10, 15, 17, 19, 20].map((x) => ({
      x,
      y: 0,
      z: 0,
    })),
    vias: [],
  }
  const prepared = preparePipeline9MutatedPreloadedSections({
    updatedFixedRoutes: [route],
    regionalMutationMasks: new Map([
      ["fixed", [false, true, false, false, false, true, false, false]],
    ]),
  })

  expect(
    prepared.sections.map((section) => [
      section.hdRoute.route[0]!.x,
      section.hdRoute.route.at(-1)!.x,
    ]),
  ).toEqual([
    [1, 3],
    [15, 17],
  ])
  expect(
    prepared.immutableHdRoutes.map((immutableRoute) =>
      immutableRoute.route.map((point) => point.x),
    ),
  ).toEqual([
    [0, 1],
    [3, 5, 10, 15],
    [17, 19, 20],
  ])

  const solver = new TraceSimplificationSolver({
    hdRoutes: prepared.sections.map((section) => section.hdRoute),
    otherHdRoutes: prepared.immutableHdRoutes,
    obstacles: [],
    connMap: new ConnectivityMap({}),
    colorMap: {},
    defaultViaDiameter: 0.5,
    layerCount: 2,
  })
  solver.solve()
  expect(solver.failed).toBeFalse()

  const applied = applyPipeline9MutatedPreloadedSections({
    updatedFixedRoutes: prepared.normalizedFixedRoutes,
    sections: prepared.sections,
    simplifiedHdRoutes: solver.simplifiedHdRoutes,
  })
  expect(
    applied.map((appliedRoute) => appliedRoute.route.map((point) => point.x)),
  ).toContainEqual([3, 5, 10, 15])
})
