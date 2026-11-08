import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { HighDensityRoute } from "lib/types/high-density-types"
import {
  Pipeline9RegionalFallbackSolver,
  hasViaToBoardObstacleConflict,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import {
  arePipeline9RoutesOnSameNet,
  doPipeline9RoutesHaveCopperConflict,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { renderRvboyRoutingView } from "../../fixtures/bug-reports/rvboy-escape-via-span/renderRvboyRoutingView"

test("RVboy LCD repair shares its existing node budget across both directions", async (): Promise<void> => {
  // Complete constructor input from the normal TSX build, before any crop.
  const captured = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/rvboy-lcd-directional-budget.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  )
  const params = {
    ...captured.params,
    connMap: new ConnectivityMap(captured.params.connMap),
    movablePreloadedConnectionNames: new Set<string>(
      captured.params.movablePreloadedConnectionNames,
    ),
  }
  const original = JSON.stringify(captured.params)
  const solver = new Pipeline9RegionalFallbackSolver(params)
  solver.solve()
  expect(solver.failed, solver.error ?? "").toBeFalse()
  expect(solver.solved).toBeTrue()
  const routes = solver.getOutput()
  const stats = solver.stats.viaClearanceRepair as {
    pathSearchNodes: number
    pathSearchCalls: number
    unresolvedSpanCount: number
  }
  expect(params.effort).toBe(1)
  expect(stats.pathSearchNodes).toBeLessThanOrEqual(1_000_000)
  expect(stats.pathSearchCalls).toBeLessThanOrEqual(100)
  expect(stats.unresolvedSpanCount).toBe(0)
  expect(routes).toHaveLength(26)
  expect(params.fixedRoutes).toHaveLength(409)
  const conflictCount = (candidates: HighDensityRoute[]): number =>
    candidates.filter((left) =>
      params.fixedRoutes.some(
        (right: HighDensityRoute) =>
          !arePipeline9RoutesOnSameNet(left, right, params.connMap) &&
          doPipeline9RoutesHaveCopperConflict({
            left,
            right,
            clearance: params.traceToPadClearance,
            layerCount: params.layerCount,
            allowBlindAndBuriedVias: params.allowBlindAndBuriedVias,
          }),
      ),
    ).length
  expect(conflictCount(captured.before)).toBeGreaterThan(0)
  expect(conflictCount(routes)).toBe(0)
  expect(hasViaToBoardObstacleConflict({ ...params, routes })).toBeFalse()
  for (const [index, route] of routes.entries()) {
    expect(route.route[0]).toEqual(captured.before[index].route[0])
    expect(route.route.at(-1)).toEqual(captured.before[index].route.at(-1))
    expect(route.traceThickness).toBe(captured.before[index].traceThickness)
  }
  expect(JSON.stringify(captured.params)).toBe(original)
  for (const [state, candidates] of [
    ["before", captured.before],
    ["after", routes],
  ] as const) {
    const graphics = convertSrjToGraphicsObject({
      bounds: params.boardGeometry.bounds,
      layerCount: params.layerCount,
      minTraceWidth: params.traceWidth,
      obstacles: params.boardObstacles.filter(
        (o: { isCopperPour?: boolean }) => !o.isCopperPour,
      ),
      connections: [],
      traces: [...params.fixedRoutes, ...candidates].map(
        (route: HighDensityRoute, index: number) => ({
          type: "pcb_trace" as const,
          pcb_trace_id: `view_${index}`,
          connection_name: route.connectionName,
          route: convertHdRouteToSimplifiedRoute(route, params.layerCount, {
            defaultViaHoleDiameter: params.viaHoleDiameter,
          }),
        }),
      ),
    })
    await expect(
      renderRvboyRoutingView(
        graphics,
        { minX: 43.5, maxX: 50.3, minY: 6, maxY: 18 },
        "RVboy LCD: reserve both clearance-search directions",
        `${state}: ${conflictCount(candidates)} routes collide with retained copper; unchanged 1,000,000-node budget`,
      ),
    ).toMatchSvgSnapshot(import.meta.path, { svgName: state })
  }
})
