import { expect, test } from "bun:test"
import type { PreloadedHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import {
  applyPipeline9MutatedPreloadedSections,
  preparePipeline9MutatedPreloadedSections,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9MutatedPreloadedTraceSimplification"
import {
  type FixedRouteSection,
  spliceFixedRouteSectionWithMutationMask,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9RegionalFallback"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("Pipeline9 preserves a fully collapsed fixed-route loop as an immutable point", () => {
  const anchor = { x: 0, y: 0, z: 0 }
  const turn = { x: 1, y: 0, z: 0 }
  const firstSourceRoute: PreloadedHighDensityRoute = {
    connectionName: "fixed_loop_0",
    rootConnectionName: "net",
    preloadedTraceIndex: 0,
    preloadedRouteIndex: 4,
    preloadedRoutePositionStart: 4,
    preloadedRoutePositionEnd: 5,
    traceThickness: 0.15,
    viaDiameter: 0.5,
    route: [anchor, turn],
    vias: [],
  }
  const secondSourceRoute: PreloadedHighDensityRoute = {
    ...firstSourceRoute,
    connectionName: "fixed_loop_1",
    preloadedRouteIndex: 5,
    preloadedRoutePositionStart: 5,
    preloadedRoutePositionEnd: 6,
    route: [turn, anchor],
  }
  const section: FixedRouteSection = {
    sourceRoutes: [firstSourceRoute, secondSourceRoute],
    start: { segmentIndex: 0, point: anchor },
    end: { segmentIndex: 0, point: anchor },
  }
  const replacement: HighDensityRoute = {
    connectionName: firstSourceRoute.connectionName,
    rootConnectionName: firstSourceRoute.rootConnectionName,
    traceThickness: firstSourceRoute.traceThickness,
    viaDiameter: firstSourceRoute.viaDiameter,
    route: [anchor],
    vias: [],
  }

  const spliced = spliceFixedRouteSectionWithMutationMask({
    section,
    replacement,
    sourceMutationMasks: new Map(),
    replacementIsMutated: true,
  })
  expect(spliced.route.route).toEqual([anchor])
  expect(spliced.mutatedSegments).toEqual([])
  expect(spliced.replacementProducedSegment).toBeFalse()

  const routeBefore: PreloadedHighDensityRoute = {
    ...firstSourceRoute,
    connectionName: "route_before_collapsed_loop",
    preloadedRouteIndex: 3,
    preloadedRoutePositionStart: 3,
    preloadedRoutePositionEnd: 4,
    route: [{ x: -1, y: 0, z: 1 }, { x: 0, y: 0, z: 1 }, anchor],
    vias: [{ x: anchor.x, y: anchor.y }],
  }
  const routeAfter: PreloadedHighDensityRoute = {
    ...firstSourceRoute,
    connectionName: "route_after_collapsed_loop",
    preloadedRouteIndex: 6,
    preloadedRoutePositionStart: 6,
    preloadedRoutePositionEnd: 7,
    route: [anchor, { x: 1, y: 0, z: 0 }],
  }
  const prepared = preparePipeline9MutatedPreloadedSections({
    updatedFixedRoutes: [routeBefore, spliced.route, routeAfter],
    regionalMutationMasks: new Map([
      [routeBefore.connectionName, [true, true]],
      [spliced.route.connectionName, spliced.mutatedSegments],
      [routeAfter.connectionName, [true]],
    ]),
  })
  expect(prepared.sections).toHaveLength(2)
  expect(
    prepared.sections.flatMap(({ section }) =>
      section.sourceRoutes.map(({ connectionName }) => connectionName),
    ),
  ).not.toContain(spliced.route.connectionName)
  expect(
    prepared.sections.every(({ hdRoute }) => hdRoute.vias.length === 0),
  ).toBeTrue()
  expect(
    prepared.immutableHdRoutes.some(
      (route) =>
        route.connectionName === spliced.route.connectionName &&
        route.route.length === 1,
    ),
  ).toBeTrue()
  expect(
    prepared.immutableHdRoutes.some(
      (route) =>
        route.connectionName.startsWith(routeBefore.connectionName) &&
        route.vias.length === 1,
    ),
  ).toBeTrue()

  const applied = applyPipeline9MutatedPreloadedSections({
    updatedFixedRoutes: prepared.normalizedFixedRoutes,
    sections: prepared.sections,
    simplifiedHdRoutes: prepared.sections.map(({ hdRoute }) => hdRoute),
  })
  expect(
    applied.find(
      (route) => route.connectionName === spliced.route.connectionName,
    )?.route,
  ).toEqual([anchor])
})
