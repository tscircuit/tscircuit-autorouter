import type { HighDensityRoute } from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"
import { renderRvboyRoutingView } from "../../fixtures/bug-reports/rvboy-escape-via-span/renderRvboyRoutingView"
import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getFixedObstacleViolations } from "@tscircuit/repair04"
import { Pipeline9RegionalFallbackSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9RegionalFallbackSolver"

test("RVboy dense regional candidates exclude the foreign ground plane", async (): Promise<void> => {
  const { params, beforeRoutes } = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/rvboy-regional-plane-layer.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString(),
  )
  const solver = new Pipeline9RegionalFallbackSolver({
    ...params,
    connMap: new ConnectivityMap(params.connMap),
    movablePreloadedConnectionNames: new Set(
      params.movablePreloadedConnectionNames,
    ),
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const routes = solver.getOutput()
  expect(routes).toHaveLength(15)
  for (const route of routes) {
    expect(route.traceThickness).toBe(params.traceWidth)
    const original = params.nodeWithPortPoints.portPoints.filter(
      (point: { connectionName: string }) =>
        point.connectionName === route.connectionName,
    )
    for (const endpoint of [route.route[0]!, route.route.at(-1)!]) {
      expect(
        original.some(
          (point: { x: number; y: number; z: number }) =>
            // Regional force-improve emits coordinates on its 1 µm grid.
            Math.hypot(point.x - endpoint.x, point.y - endpoint.y) <= 0.001 &&
            point.z === endpoint.z,
        ),
      ).toBe(true)
    }
  }
  const violations = getFixedObstacleViolations({
    srj: {
      ...params.boardGeometry,
      layerCount: params.layerCount,
      minTraceWidth: params.traceWidth,
      obstacles: params.obstacles.filter(
        (obstacle: { isCopperPour?: boolean }) => obstacle.isCopperPour,
      ),
      connections: [],
    },
    routes,
    traceClearance: 0.1,
  })
  expect(violations.filter((violation) => violation.kind === "wire")).toEqual(
    [],
  )
  const node = params.nodeWithPortPoints
  const viewbox = {
    minX: node.center.x - node.width / 2 - 0.4,
    maxX: node.center.x + node.width / 2 + 0.4,
    minY: node.center.y - node.height / 2 - 0.4,
    maxY: node.center.y + node.height / 2 + 0.4,
  }
  for (const [name, candidate] of [
    ["before", beforeRoutes],
    ["after", routes],
  ] as const) {
    const graphics = convertSrjToGraphicsObject({
      bounds: viewbox,
      layerCount: params.layerCount,
      minTraceWidth: params.traceWidth,
      obstacles: [],
      connections: [],
      traces: candidate
        .filter(
          (route: HighDensityRoute) => route.connectionName === "source_net_70",
        )
        .map((route: HighDensityRoute) => ({
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
        "RVboy: source_net_70 beside the SoC",
        name === "before"
          ? "Before: candidate wires short the ground plane"
          : "After: signal wires avoid the ground plane",
      ),
    ).toMatchSvgSnapshot(import.meta.path, { svgName: name })
  }
})
