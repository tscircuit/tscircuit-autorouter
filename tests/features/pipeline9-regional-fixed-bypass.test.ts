import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import { doPipeline9RoutesHaveCopperConflict } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { renderRvboyRoutingView } from "../../fixtures/bug-reports/rvboy-escape-via-span/renderRvboyRoutingView"

test("RVboy regional repair routes around an exact fixed bypass without moving it", async (): Promise<void> => {
  const fixture = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/rvboy-regional-fixed-bypass.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  )
  const params = {
    ...fixture.params,
    connMap: new ConnectivityMap(fixture.params.connMap),
    movablePreloadedConnectionNames: new Set<string>(
      fixture.params.movablePreloadedConnectionNames,
    ),
  }
  const original = structuredClone(params.fixedRoutes)
  const solver = new Pipeline9RegionalFallbackSolver(params)
  solver.solve()
  expect(solver.solved, solver.error ?? "").toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.stats.fixedCopperCandidateRejectionCount).toBeGreaterThan(0)
  expect(solver.viaClearanceSolver!.getOutput().unresolvedSpanCount).toBe(0)
  const beforeRoutes = solver.repairSolver!.getOutput()
  const afterRoutes = solver.getOutput()
  const conflicts = (routes: HighDensityRoute[]): boolean =>
    routes.some((route) =>
      params.fixedRoutes.some((fixed: HighDensityRoute) =>
        doPipeline9RoutesHaveCopperConflict({
          left: route,
          right: fixed,
          clearance: 0.1,
          layerCount: params.layerCount,
        }),
      ),
    )
  expect(conflicts(beforeRoutes)).toBe(true)
  expect(conflicts(afterRoutes)).toBe(false)
  expect(params.fixedRoutes).toEqual(original)
  expect(
    solver
      .viaClearanceSolver!.getOutput()
      .routes.slice(afterRoutes.length)
      .map((route) => route.route),
  ).toEqual(original.map((route: HighDensityRoute) => route.route))
  for (const [index, route] of afterRoutes.entries()) {
    expect(route.route[0]).toEqual(beforeRoutes[index]!.route[0])
    expect(route.route.at(-1)).toEqual(beforeRoutes[index]!.route.at(-1))
  }
  const viewbox = { minX: 5.7, maxX: 8, minY: 13.2, maxY: 15.8 }
  for (const [name, routes] of [
    ["before", beforeRoutes],
    ["after", afterRoutes],
  ] as const) {
    const graphics = convertSrjToGraphicsObject({
      ...params.boardGeometry,
      layerCount: params.layerCount,
      minTraceWidth: params.traceWidth,
      obstacles: [],
      connections: [],
      traces: [...routes, ...params.fixedRoutes].map(
        (route: HighDensityRoute) => ({
          type: "pcb_trace" as const,
          pcb_trace_id: route.connectionName,
          connection_name: route.connectionName,
          route: convertHdRouteToSimplifiedRoute(route, params.layerCount),
        }),
      ),
    })
    await expect(
      renderRvboyRoutingView(
        graphics,
        viewbox,
        "RVboy: preserve the short bypass",
        name === "before"
          ? "Before: regional signals cross the fixed bypass"
          : "After: signals change layers; bypass copper stays unchanged",
      ),
    ).toMatchSvgSnapshot(import.meta.path, { svgName: name })
  }
})
