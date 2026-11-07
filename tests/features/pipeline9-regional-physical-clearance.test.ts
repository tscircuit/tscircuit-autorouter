import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { renderRvboyRoutingView } from "../../fixtures/bug-reports/rvboy-escape-via-span/renderRvboyRoutingView"

test("RVboy regional via repair uses physical clearance at legal fixed endpoints", async (): Promise<void> => {
  const { params } = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/rvboy-regional-planning-margin.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  )
  const planningMarginSolver = new Pipeline9RegionalFallbackSolver({
    ...params,
    connMap: new ConnectivityMap(params.connMap),
    movablePreloadedConnectionNames: new Set(
      params.movablePreloadedConnectionNames,
    ),
  })
  planningMarginSolver.solve()
  expect(planningMarginSolver.failed).toBe(true)
  expect(planningMarginSolver.viaClearanceSolver?.stats.pathSearchNodes).toBe(0)

  const solver = new Pipeline9RegionalFallbackSolver({
    ...params,
    traceToPadClearance: 0.1,
    connMap: new ConnectivityMap(params.connMap),
    movablePreloadedConnectionNames: new Set(
      params.movablePreloadedConnectionNames,
    ),
  })
  solver.solve()
  expect(solver.solved, solver.error ?? "").toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.viaClearanceSolver?.stats.pathSearchNodes).toBeGreaterThan(0)
  expect(solver.viaClearanceSolver?.getOutput().unresolvedSpanCount).toBe(0)
  const viaObstacle = params.boardObstacles.find(
    (obstacle: { obstacleId?: string }) =>
      obstacle.obstacleId?.startsWith("escape-via-obstacle:"),
  )
  for (const route of solver.getOutput()) {
    for (const via of route.vias) {
      const gap =
        Math.hypot(
          Math.max(
            Math.abs(via.x - viaObstacle.center.x) - viaObstacle.width / 2,
            0,
          ),
          Math.max(
            Math.abs(via.y - viaObstacle.center.y) - viaObstacle.height / 2,
            0,
          ),
        ) -
        route.viaDiameter / 2
      expect(gap).toBeGreaterThanOrEqual(params.viaToPadClearance)
    }
  }
  const viewbox = { minX: -32.25, maxX: -30.75, minY: -34, maxY: -32.5 }
  for (const [name, routes] of [
    ["before", planningMarginSolver.viaClearanceSolver!.getOutput().routes],
    ["after", solver.getOutput()],
  ] as const) {
    const graphics = convertSrjToGraphicsObject({
      ...params.boardGeometry,
      layerCount: params.layerCount,
      minTraceWidth: params.traceWidth,
      minViaDiameter: params.viaDiameter,
      minViaHoleDiameter: params.viaHoleDiameter,
      // Crop the drawing, not the exact solver input.
      obstacles: params.boardObstacles.filter(
        (o: {
          isCopperPour?: boolean
          center: { x: number; y: number }
          width: number
          height: number
        }) =>
          !o.isCopperPour &&
          o.center.x + o.width / 2 >= viewbox.minX &&
          o.center.x - o.width / 2 <= viewbox.maxX &&
          o.center.y + o.height / 2 >= viewbox.minY &&
          o.center.y - o.height / 2 <= viewbox.maxY,
      ),
      connections: [],
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
        "RVboy: regional repair at the battery regulator",
        name === "before"
          ? "Before: planning margin blocks the endpoint; conflicting vias remain"
          : "After: physical clearance permits repair; both routes stay on top",
      ),
    ).toMatchSvgSnapshot(import.meta.path, { svgName: name })
  }
})
