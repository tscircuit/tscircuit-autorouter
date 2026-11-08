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

test("RVboy USB regional repair can escape from the opposite edge of its terminal pad", async (): Promise<void> => {
  const capture = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/rvboy-usb-terminal-bounds.json.gz",
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
  const solver = new Pipeline9RegionalFallbackSolver(params)
  solver.solve()
  expect(solver.solved, solver.error ?? "").toBe(true)
  expect(solver.failed).toBe(false)
  expect(capture).toEqual(original)
  expect(solver.viaClearanceSolver?.getOutput().unresolvedSpanCount).toBe(0)
  const routes = solver.getOutput()
  expect(routes).toHaveLength(capture.beforeRoutes.length)
  for (const route of routes) {
    const before = capture.beforeRoutes.find(
      (r) =>
        r.connectionName === route.connectionName &&
        r.route[0]!.x === route.route[0]!.x &&
        r.route[0]!.y === route.route[0]!.y &&
        r.route[0]!.z === route.route[0]!.z,
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
  const viewbox = { minX: 0.15, maxX: 3.25, minY: 30.4, maxY: 32.7 }
  for (const [name, candidates] of [
    ["before", capture.beforeRoutes],
    ["after", routes],
  ] as const) {
    const target = candidates.filter(
      (r) => r.connectionName === "source_trace_4__source_net_40_mst2",
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
        "RVboy: USB data escape beside retained power copper",
        name === "before"
          ? "Before: the search window excludes the other side of the terminal pad"
          : "After: the full terminal pad fits and the via clears retained power copper",
      ),
    ).toMatchSvgSnapshot(import.meta.path, { svgName: name })
  }
})
