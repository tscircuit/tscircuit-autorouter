import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { PreloadedHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import {
  applyPipeline9MutatedPreloadedSections,
  preparePipeline9MutatedPreloadedSections,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9MutatedPreloadedTraceSimplification"
import { TraceSimplificationSolver } from "lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver"

test("Pipeline9 locks vias at mutation-section boundaries", () => {
  const route: PreloadedHighDensityRoute = {
    connectionName: "fixed",
    rootConnectionName: "net",
    preloadedTraceIndex: 0,
    preloadedRouteIndex: 0,
    preloadedRoutePositionStart: 0,
    preloadedRoutePositionEnd: 4,
    traceThickness: 0.15,
    viaDiameter: 0.5,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 0.02, y: 0, z: 1 },
      { x: 0.02, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ],
    vias: [
      { x: 0, y: 0 },
      { x: 0.02, y: 0 },
    ],
  }
  const prepared = preparePipeline9MutatedPreloadedSections({
    updatedFixedRoutes: [route],
    regionalMutationMasks: new Map([
      [route.connectionName, [false, false, true, true]],
    ]),
  })

  expect(prepared.sections).toHaveLength(1)
  expect(prepared.sections[0]!.hdRoute.vias).toEqual([])
  expect(prepared.immutableHdRoutes).toHaveLength(1)
  expect(prepared.immutableHdRoutes[0]!.vias).toEqual(route.vias)

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
  expect(applied.flatMap((appliedRoute) => appliedRoute.vias)).toEqual(
    route.vias,
  )
})
