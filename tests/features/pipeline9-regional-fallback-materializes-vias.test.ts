import { expect, test } from "bun:test"
import { spliceFixedRouteSection } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9-regional-fallback"
import type { PreloadedHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convert-preloaded-traces-to-hd-routes"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("Pipeline9 materializes implied fallback layer transitions as vias", () => {
  const sourceRoute: PreloadedHighDensityRoute = {
    connectionName: "preloaded_fixed_0_0",
    rootConnectionName: "net0",
    preloadedTraceIndex: 0,
    preloadedRouteIndex: 0,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
    ],
    vias: [],
  }
  const replacement: HighDensityRoute = {
    connectionName: sourceRoute.connectionName,
    rootConnectionName: sourceRoute.rootConnectionName,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 5, y: 1, z: 1 },
      { x: 10, y: 0, z: 0 },
    ],
    vias: [],
  }

  const splicedRoute = spliceFixedRouteSection(
    {
      sourceRoutes: [sourceRoute],
      start: { segmentIndex: 0, point: sourceRoute.route[0]! },
      end: { segmentIndex: 0, point: sourceRoute.route[1]! },
    },
    replacement,
  )

  expect(splicedRoute.route).toEqual([
    { x: 0, y: 0, z: 0 },
    { x: 5, y: 1, z: 0 },
    { x: 5, y: 1, z: 1 },
    { x: 10, y: 0, z: 1 },
    { x: 10, y: 0, z: 0 },
  ])
  expect(splicedRoute.vias).toEqual([
    { x: 5, y: 1 },
    { x: 10, y: 0 },
  ])
})
