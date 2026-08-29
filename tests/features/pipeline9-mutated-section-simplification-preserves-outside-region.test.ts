import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  applyPipeline9MutatedPreloadedSections,
  preparePipeline9MutatedPreloadedSections,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9MutatedPreloadedTraceSimplification"
import { TraceSimplificationSolver } from "lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver"
import {
  createHighlightedMutationFixture,
  createOutsideRegionViaRoute,
} from "../fixtures/pipeline9-mutated-section-simplification"

test("Pipeline9 keeps preloaded vias outside an accepted mutation region unchanged", () => {
  const fixture = createHighlightedMutationFixture()
  const outsideRegionRoute = createOutsideRegionViaRoute()
  const updatedFixedRoutes = [outsideRegionRoute, ...fixture.updatedFixedRoutes]
  const prepared = preparePipeline9MutatedPreloadedSections({
    updatedFixedRoutes,
    regionalMutationMasks: fixture.regionalMutationMasks,
  })

  expect(prepared.sections).toHaveLength(1)
  expect(prepared.sections[0]!.hdRoute.vias).toHaveLength(2)
  expect(prepared.sections[0]!.hdRoute.route[0]).toMatchObject({
    x: 8.379,
    z: 0,
  })
  expect(prepared.immutableHdRoutes).toHaveLength(1)
  expect(prepared.immutableHdRoutes[0]!.vias).toEqual([
    { x: 3, y: -4 },
    { x: 3.4, y: -4 },
  ])
  expect(prepared.immutableHdRoutes[0]!.route.at(-1)).toMatchObject({
    x: 8.379,
    z: 0,
  })

  const solver = new TraceSimplificationSolver({
    hdRoutes: prepared.sections.map((section) => section.hdRoute),
    otherHdRoutes: prepared.immutableHdRoutes,
    obstacles: [],
    connMap: new ConnectivityMap({}),
    colorMap: {},
    defaultViaDiameter: 0.5,
    layerCount: 2,
    enableCrossingViaReduction: true,
  })
  solver.solve()
  expect(solver.failed).toBeFalse()

  const appliedRoutes = applyPipeline9MutatedPreloadedSections({
    updatedFixedRoutes: prepared.normalizedFixedRoutes,
    sections: prepared.sections,
    simplifiedHdRoutes: solver.simplifiedHdRoutes,
  })
  expect(appliedRoutes).toHaveLength(2)
  expect(appliedRoutes[0]).toEqual(outsideRegionRoute)
  expect(appliedRoutes.flatMap((route) => route.vias)).toEqual([
    { x: 3, y: -4 },
    { x: 3.4, y: -4 },
  ])
})
