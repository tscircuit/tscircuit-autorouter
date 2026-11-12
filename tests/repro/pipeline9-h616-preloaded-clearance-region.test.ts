import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { pointToSegmentDistance } from "@tscircuit/math-utils"
import type { AnyCircuitElement } from "circuit-json"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { type GraphicsObject, getSvgFromGraphicsObject } from "graphics-debug"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import {
  Pipeline9HighDensitySolver,
  type Pipeline9HighDensitySolverParams,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import {
  arePipeline9RoutesOnSameNet,
  doPipeline9RoutesHaveCopperConflict,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import type { SimpleRouteJson } from "lib/types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { convertSrjToGraphicsObject } from "lib/utils/convertSrjToGraphicsObject"

type RegionalFixture = {
  params: Omit<Pipeline9HighDensitySolverParams, "connMap">
  netMap: ConnectivityMap["netMap"]
}

test("routes the H616 SVREF boundary beside a preloaded DDR via", async (): Promise<void> => {
  const board = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/assets/h616-preloaded-board-clearance.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  ) as { circuitJson: AnyCircuitElement[]; srj: SimpleRouteJson }
  const fixture = JSON.parse(
    gunzipSync(
      new Uint8Array(
        readFileSync(
          new URL(
            "../fixtures/assets/h616-preloaded-clearance-region.json.gz",
            import.meta.url,
          ),
        ),
      ),
    ).toString("utf8"),
  ) as RegionalFixture
  // Obtain the clearance from the real pipeline, then replay its captured
  // failing node with the same two DDR routes and unchanged via geometry.
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    board.srj,
    { cacheProvider: null },
  )
  pipeline.solveUntilPhase("highDensityRouteSolver")
  pipeline.step()
  const solver = new Pipeline9HighDensitySolver({
    ...fixture.params,
    connMap: new ConnectivityMap(fixture.netMap),
    obstacleMargin: pipeline.highDensityRouteSolver!.obstacleMargin,
  })
  expect(() => solver.solve()).not.toThrow()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(solver.routes).toHaveLength(1)
  const routes = [...solver.getUpdatedFixedHdRoutes(), ...solver.routes]
  const boardClearance = board.srj.minTraceToPadEdgeClearance!
  for (const [index, left] of routes.entries()) {
    for (const right of routes.slice(index + 1)) {
      if (arePipeline9RoutesOnSameNet(left, right, solver.connMap)) continue
      expect(
        doPipeline9RoutesHaveCopperConflict({
          left,
          right,
          clearance: boardClearance,
          layerCount: board.srj.layerCount,
        }),
      ).toBeFalse()
    }
  }
  const viaRoute = solver
    .getUpdatedFixedHdRoutes()
    .find((route) => route.vias.length > 0)!
  const traceRoute = solver
    .getUpdatedFixedHdRoutes()
    .find((route) => route.vias.length === 0)!
  const gap =
    pointToSegmentDistance(
      viaRoute.vias[0]!,
      traceRoute.route[0]!,
      traceRoute.route[1]!,
    ) -
    (viaRoute.viaDiameter + traceRoute.traceThickness) / 2
  expect(gap).toBeGreaterThanOrEqual(boardClearance)
  const graphics: GraphicsObject = convertSrjToGraphicsObject({
    ...board.srj,
    outline: undefined,
    connections: [],
    obstacles: [],
    traces: routes.map((route, index) => ({
      type: "pcb_trace",
      pcb_trace_id: `${route.connectionName}_${index}`,
      connection_name: route.connectionName,
      route: convertHdRouteToSimplifiedRoute(route, board.srj.layerCount),
    })),
  })
  const node = fixture.params.nodePortPoints[0]!
  graphics.rects!.push({
    center: node.center,
    width: node.width,
    height: node.height,
    stroke: "#64748b",
    fill: "transparent",
  })
  const labelX = Math.min(...traceRoute.route.map((point) => point.x))
  const labelY = Math.min(...traceRoute.route.map((point) => point.y)) - 0.4
  graphics.texts = [
    {
      x: labelX,
      y: labelY,
      text: `SVREF region: ${solver.solved ? "routed" : "blocked"}`,
      fontSize: 0.2,
      color: solver.solved ? "#166534" : "#b91c1c",
      anchorSide: "center_left",
    },
    {
      x: labelX,
      y: labelY - 0.3,
      text: `Via–trace gap: ${gap.toFixed(3)} mm (minimum ${boardClearance.toFixed(3)} mm)`,
      fontSize: 0.16,
      anchorSide: "center_left",
    },
    {
      x: labelX,
      y: labelY - 0.6,
      text: `Routing clearance: ${solver.obstacleMargin.toFixed(3)} mm`,
      fontSize: 0.16,
      anchorSide: "center_left",
    },
  ]
  await expect(
    getSvgFromGraphicsObject(graphics, { backgroundColor: "white" }),
  ).toMatchSvgSnapshot(import.meta.path)
})
