import { expect, test } from "bun:test"
import { applyFixedRouteReplacementsToPreloadedTraces } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyFixedRouteReplacementsToPreloadedTraces"
import { convertPreloadedTraceToHdRoutes } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convertPreloadedTraceToHdRoutes"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createPreloadedSeamFixture } from "../fixtures/pipeline9-preloaded-seam-fixture"

test("rebuilding distinguishes an explicitly unchanged source interval from a deliberate same-centerline width replacement", (): void => {
  const fixture = createPreloadedSeamFixture()
  const original = fixture.sourceSrj.traces![0]!
  if (original.route[1]!.route_type !== "wire") throw new Error("Expected source wire")
  original.route[1]!.width = 0.2
  const connMap = getConnectivityMapFromSimpleRouteJson(fixture.sourceSrj)
  const fixed = convertPreloadedTraceToHdRoutes(original, 0, 2, 0.3, connMap)
  expect(fixed[0]!.traceThickness).toBe(0.2)
  for (const unchanged of [false, true]) {
    const output = applyFixedRouteReplacementsToPreloadedTraces({
      originalTraces: [original], originalFixedRoutes: fixed, updatedFixedRoutes: structuredClone(fixed),
      replacedConnectionNames: new Set(fixed.map((route) => route.connectionName)),
      unchangedFixedRouteConnectionNames: unchanged ? new Set(fixed.map((route) => route.connectionName)) : new Set(),
      layerCount: 2, defaultViaHoleDiameter: 0.15, obstacles: [], connMap,
    }).updatedPreloadedTraces[0]!
    expect(output.route[0]).toMatchObject({ width: unchanged ? 0.1 : 0.2, x: -2, y: 0 })
    expect(output.route.at(-1)).toMatchObject({ width: 0.2, x: 2, y: 0 })
  }
  expect(fixed[0]!.route[0]!.traceThickness).toBeUndefined()
})
