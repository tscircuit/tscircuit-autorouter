import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { renderRvboyRoutingView } from "../../fixtures/bug-reports/rvboy-escape-via-span/renderRvboyRoutingView"

test("RVboy regional via repair clears foreign copper using physical board clearance", async (): Promise<void> => {
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
  const beforeRoutes = solver.repairSolver!.getOutput()
  const outputRoutes = solver.getOutput()
  expect(beforeRoutes.flatMap((route) => route.vias).length).toBeGreaterThan(0)
  expect(outputRoutes.flatMap((route) => route.vias)).toEqual([])
  for (const [index, route] of outputRoutes.entries()) {
    expect(route.route[0]).toEqual(beforeRoutes[index]!.route[0])
    expect(route.route.at(-1)).toEqual(beforeRoutes[index]!.route.at(-1))
  }
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
    ["before", beforeRoutes],
    ["after", outputRoutes],
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
          ? "Before clearance repair: conflicting vias remain"
          : "After: physical clearance permits repair; both routes stay on top",
      ),
    ).toMatchSvgSnapshot(import.meta.path, { svgName: name })
  }
})
