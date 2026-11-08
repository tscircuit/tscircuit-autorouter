import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { getFixedObstacleViolations } from "@tscircuit/repair04"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import {
  Pipeline9HighDensitySolver,
  type Pipeline9HighDensitySolverParams,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { preparePipeline9RepairConnectivity } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/preparePipeline9RepairConnectivity"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { renderRvboyRoutingView } from "../../fixtures/bug-reports/rvboy-escape-via-span/renderRvboyRoutingView"

type CapturedInput = {
  params: Omit<Pipeline9HighDensitySolverParams, "connMap"> & {
    connectivityNetMap: Record<string, string[]>
  }
  beforeRoutes: HighDensityRoute[]
}

test("RVboy inner-layer routing clears through-vias on every drilled layer", async (): Promise<void> => {
  // Exact cmn_439 input, including all 1,193 board obstacles and 600 retained
  // route pieces. Only the visualization is cropped; the solve uses all context.
  const captured = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/rvboy-inner-node-through-via.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  ) as CapturedInput
  const original = structuredClone(captured)
  const { params, beforeRoutes } = captured
  const connMap = new ConnectivityMap(params.connectivityNetMap)
  const solver = new Pipeline9HighDensitySolver({ ...params, connMap })
  solver.solve()
  expect(solver.solved, solver.error ?? "").toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.stats.fallbackNodeCount).toBe(1)
  expect(solver.getUpdatedFixedHdRoutes()).toEqual(params.fixedHdRoutes)
  expect(captured).toEqual(original)
  expect(solver.routes).toHaveLength(beforeRoutes.length)
  for (const route of solver.routes) {
    const before = beforeRoutes.find(
      (r) => r.connectionName === route.connectionName,
    )!
    expect(route.route[0]).toEqual(before.route[0])
    expect(route.route.at(-1)).toEqual(before.route.at(-1))
  }
  const srj = {
    ...params.boardGeometry!,
    layerCount: params.layerCount,
    minTraceWidth: params.traceWidth,
    minViaDiameter: params.viaDiameter,
    minViaHoleDiameter: params.viaHoleDiameter,
    obstacles: params.obstacles,
    connections: [],
  }
  const violations = [beforeRoutes, solver.routes].map((routes) => {
    const prepared = preparePipeline9RepairConnectivity({
      srj,
      routes,
      connMap,
    })
    return getFixedObstacleViolations({
      ...prepared,
      srj: { ...prepared.srj, traces: undefined },
      traceClearance: params.traceToPadClearance,
      viaClearance: params.viaToPadClearance,
    })
  })
  expect(violations[0]!.some((violation) => violation.kind === "via")).toBe(
    true,
  )
  expect(violations[1]).toEqual([])
  const viewbox = { minX: -0.8, maxX: 2.3, minY: 7.6, maxY: 12.0 }
  for (const [name, routes] of [
    ["before", beforeRoutes],
    ["after", solver.routes],
  ] as const) {
    const graphics = convertSrjToGraphicsObject({
      ...srj,
      obstacles: params.obstacles.filter(
        (o) =>
          !o.isCopperPour &&
          o.center.x + o.width / 2 >= viewbox.minX &&
          o.center.x - o.width / 2 <= viewbox.maxX &&
          o.center.y + o.height / 2 >= viewbox.minY &&
          o.center.y - o.height / 2 <= viewbox.maxY,
      ),
      traces: routes.map((route) => ({
        type: "pcb_trace" as const,
        pcb_trace_id: route.connectionName,
        connection_name: route.connectionName,
        route: convertHdRouteToSimplifiedRoute(route, params.layerCount),
      })),
    })
    await expect(
      renderRvboyRoutingView(
        graphics,
        viewbox,
        "RVboy: through-vias beneath the processor",
        name === "before"
          ? "Before: a new signal via overlaps the retained ground via"
          : "After: vias clear the ground via and the overlying surface pad",
      ),
    ).toMatchSvgSnapshot(import.meta.path, { svgName: name })
  }
})
