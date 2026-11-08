import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import {
  arePipeline9RoutesOnSameNet,
  doPipeline9RoutesHaveCopperConflict,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { renderRvboyRoutingView } from "../../fixtures/bug-reports/rvboy-escape-via-span/renderRvboyRoutingView"

type Pipeline9RegionalFallbackSolverParams = ConstructorParameters<
  typeof Pipeline9RegionalFallbackSolver
>[0]

type Capture = {
  params: Omit<
    Pipeline9RegionalFallbackSolverParams,
    "connMap" | "nodePfById" | "movablePreloadedConnectionNames"
  > & {
    connMap: Record<string, string[]>
    nodePfById: Record<string, number>
    movablePreloadedConnectionNames: string[]
  }
  beforeRoutes: HighDensityRoute[]
}

test("RVboy fine-grid regional repair can use the remaining search budget", async (): Promise<void> => {
  const capture = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/rvboy-lcd-regional-budget.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  ) as Capture
  const original = structuredClone(capture)
  const params = {
    ...capture.params,
    connMap: new ConnectivityMap(capture.params.connMap),
    nodePfById: new Map(Object.entries(capture.params.nodePfById)),
    movablePreloadedConnectionNames: new Set(
      capture.params.movablePreloadedConnectionNames,
    ),
  }
  expect(
    capture.beforeRoutes.some((route) =>
      params.fixedRoutes!.some(
        (fixed) =>
          !arePipeline9RoutesOnSameNet(route, fixed, params.connMap) &&
          doPipeline9RoutesHaveCopperConflict({
            left: route,
            right: fixed,
            clearance: params.traceToPadClearance!,
            layerCount: params.layerCount,
            allowBlindAndBuriedVias: params.allowBlindAndBuriedVias,
          }),
      ),
    ),
  ).toBeTrue()
  const solver = new Pipeline9RegionalFallbackSolver(params)
  solver.solve()
  expect(solver.solved, solver.error ?? "").toBe(true)
  expect(solver.failed).toBe(false)
  expect(capture).toEqual(original)
  const routes = solver.getOutput()
  expect(routes).toHaveLength(capture.beforeRoutes.length)
  for (const route of routes) {
    const before = capture.beforeRoutes.find(
      (r) =>
        r.connectionName === route.connectionName &&
        r.route[0]!.x === route.route[0]!.x &&
        r.route[0]!.y === route.route[0]!.y &&
        r.route[0]!.z === route.route[0]!.z &&
        r.route.at(-1)!.x === route.route.at(-1)!.x &&
        r.route.at(-1)!.y === route.route.at(-1)!.y &&
        r.route.at(-1)!.z === route.route.at(-1)!.z,
    )!
    expect(before).toBeDefined()
    expect(route.route[0]).toEqual(before.route[0])
    expect(route.route.at(-1)).toEqual(before.route.at(-1))
    for (const fixed of params.fixedRoutes!) {
      if (arePipeline9RoutesOnSameNet(route, fixed, params.connMap)) continue
      expect(
        doPipeline9RoutesHaveCopperConflict({
          left: route,
          right: fixed,
          clearance: params.traceToPadClearance!,
          layerCount: 4,
        }),
      ).toBe(false)
    }
  }
  expect(solver.stats.viaClearanceRepair.unresolvedSpanCount).toBe(0)
  expect(solver.stats.viaClearanceRepair.pathSearchNodes).toBeLessThanOrEqual(
    1_000_000,
  )
  const viewbox = { minX: 43.9, maxX: 49.3, minY: 8.0, maxY: 13.1 }
  for (const [name, candidates] of [
    ["before", capture.beforeRoutes],
    ["after", routes],
  ] as const) {
    const target = candidates.filter(
      (r) =>
        r.connectionName === "source_net_66" &&
        Math.abs(r.route.at(-1)!.y - 8.579166166666665) < 1e-6,
    )
    const graphics = convertSrjToGraphicsObject({
      ...params.boardGeometry!,
      layerCount: 4,
      minTraceWidth: 0.1,
      connections: [],
      obstacles: params.boardObstacles!.filter(
        (o) =>
          !o.isCopperPour &&
          o.center.x + o.width / 2 >= viewbox.minX &&
          o.center.x - o.width / 2 <= viewbox.maxX &&
          o.center.y + o.height / 2 >= viewbox.minY &&
          o.center.y - o.height / 2 <= viewbox.maxY,
      ),
      traces: [...params.fixedRoutes!, ...target].map((r) => ({
        type: "pcb_trace" as const,
        pcb_trace_id: r.connectionName,
        connection_name: r.connectionName,
        route: convertHdRouteToSimplifiedRoute(r, 4),
      })),
    })
    await expect(
      renderRvboyRoutingView(
        graphics,
        viewbox,
        "RVboy: LCD signal beside retained connector copper",
        name === "before"
          ? "Before: 100k per-call limit leaves a via too close to retained copper"
          : "After: fine-grid search completes within the same total regional budget",
      ),
    ).toMatchSvgSnapshot(import.meta.path, { svgName: name })
  }
})
