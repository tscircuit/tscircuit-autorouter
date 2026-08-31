import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { PreloadedHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import {
  findAbsorbedFixedSectionReplacement,
  type FixedRouteSection,
  spliceFixedRouteSection,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9RegionalFallback"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("Pipeline9 reuses a coincident same-net route when it absorbs a promoted fixed section", () => {
  const fixedRoute: PreloadedHighDensityRoute = {
    connectionName: "breakout_fixed_0",
    rootConnectionName: "shared_net",
    preloadedTraceIndex: 0,
    preloadedRouteIndex: 0,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: -0.5, y: 0, z: 0 },
      { x: 1.5, y: 0, z: 0 },
    ],
    vias: [],
  }
  const section: FixedRouteSection = {
    sourceRoutes: [fixedRoute],
    start: { segmentIndex: 0, point: { x: 0, y: 0, z: 0 } },
    end: { segmentIndex: 0, point: { x: 1, y: 0, z: 0 } },
  }
  const absorbedRoute: HighDensityRoute = {
    connectionName: "routed_branch",
    rootConnectionName: "shared_net",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 0.5, y: 0.5, z: 0 },
      { x: 1.0005, y: 0, z: 0 },
    ],
    vias: [],
  }
  const unrelatedRoute: HighDensityRoute = {
    ...absorbedRoute,
    connectionName: "unrelated",
    rootConnectionName: "other_net",
  }

  const replacement = findAbsorbedFixedSectionReplacement({
    section,
    candidateRoutes: [unrelatedRoute, absorbedRoute],
    connMap: new ConnectivityMap({}),
  })

  expect(replacement).not.toBeNull()
  expect(replacement).toMatchObject({
    connectionName: fixedRoute.connectionName,
    rootConnectionName: fixedRoute.rootConnectionName,
    route: absorbedRoute.route,
  })
  expect(spliceFixedRouteSection(section, replacement!).route).toEqual([
    fixedRoute.route[0],
    section.start.point,
    absorbedRoute.route[1],
    section.end.point,
    fixedRoute.route[1],
  ])
})
