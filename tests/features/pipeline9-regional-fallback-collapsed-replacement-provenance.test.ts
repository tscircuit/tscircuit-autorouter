import { expect, test } from "bun:test"
import type { PreloadedHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import {
  type FixedRouteSection,
  getFixedRouteMutationCoverageInsideNode,
  spliceFixedRouteSectionWithMutationMask,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9RegionalFallback"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"

test("Pipeline9 records a collapsed same-boundary replacement as having no surviving mutation segment", () => {
  const firstSourceRoute: PreloadedHighDensityRoute = {
    connectionName: "fixed_hairpin_0",
    rootConnectionName: "net",
    preloadedTraceIndex: 0,
    preloadedRouteIndex: 0,
    preloadedRoutePositionStart: 37,
    preloadedRoutePositionEnd: 38,
    traceThickness: 0.15,
    viaDiameter: 0.5,
    route: [
      { x: -2, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ],
    vias: [],
  }
  const secondSourceRoute: PreloadedHighDensityRoute = {
    ...firstSourceRoute,
    connectionName: "fixed_hairpin_1",
    preloadedRouteIndex: 1,
    preloadedRoutePositionStart: 38,
    preloadedRoutePositionEnd: 39,
    route: [
      { x: 2, y: 0, z: 0 },
      { x: -1, y: 0, z: 0 },
    ],
  }
  const boundaryPoint = { x: 0, y: 0, z: 0 }
  const section: FixedRouteSection = {
    sourceRoutes: [firstSourceRoute, secondSourceRoute],
    start: { segmentIndex: 0, point: boundaryPoint },
    end: { segmentIndex: 0, point: boundaryPoint },
  }
  const replacement: HighDensityRoute = {
    connectionName: firstSourceRoute.connectionName,
    rootConnectionName: firstSourceRoute.rootConnectionName,
    traceThickness: firstSourceRoute.traceThickness,
    viaDiameter: firstSourceRoute.viaDiameter,
    route: [boundaryPoint],
    vias: [],
  }

  const result = spliceFixedRouteSectionWithMutationMask({
    section,
    replacement,
    sourceMutationMasks: new Map(),
    replacementIsMutated: true,
  })

  expect(result.replacementProducedSegment).toBeFalse()
  expect(result.mutatedSegments).toEqual([false, false])
  expect(result.route.preloadedRoutePositionStart).toBe(37)
  expect(result.route.preloadedRoutePositionEnd).toBe(39)
  expect(result.route.route).toEqual([
    { x: -2, y: 0, z: 0 },
    boundaryPoint,
    { x: -1, y: 0, z: 0 },
  ])
  expect(result.route.vias).toEqual([])
})

test("Pipeline9 recognizes exact provenance on a returning boundary loop", () => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "node",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0],
    portPoints: [],
  }
  const route: PreloadedHighDensityRoute = {
    connectionName: "fixed_returning_loop",
    rootConnectionName: "net",
    preloadedTraceIndex: 0,
    preloadedRouteIndex: 0,
    preloadedRoutePositionStart: 37,
    preloadedRoutePositionEnd: 39,
    traceThickness: 0.15,
    viaDiameter: 0.5,
    route: [
      { x: -2, y: 0, z: 0 },
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: -1, y: 0, z: 0 },
      { x: -2, y: 0, z: 0 },
    ],
    vias: [],
  }

  expect(
    getFixedRouteMutationCoverageInsideNode({
      route,
      node,
      mutationMask: [false, true, true, false],
    }),
  ).toEqual({ hasMaterialCopper: true, isFullyCovered: true })
  expect(
    getFixedRouteMutationCoverageInsideNode({
      route,
      node,
      mutationMask: [false, true, false, false],
    }),
  ).toEqual({ hasMaterialCopper: true, isFullyCovered: false })
})
