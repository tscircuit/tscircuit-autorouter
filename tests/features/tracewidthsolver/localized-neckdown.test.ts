import { expect, test } from "bun:test"
import {
  doPipeline9RoutesHaveCopperConflict,
  getPipeline9RouteCopperGeometry,
} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"

test("nominal-width copper fits on both sides of an interior neckdown", (): void => {
  const fixed: HighDensityRoute = {
    connectionName: "fixed",
    traceThickness: 0.05,
    viaDiameter: 0.5,
    vias: [{ x: 12.5, y: 0.43 }],
    route: [
      { x: 4.25, y: 0.29, z: 0, traceThickness: 0.22 },
      { x: 4.75, y: 0.29, z: 0, traceThickness: 0.22 },
    ],
  }
  const signal: HighDensityRoute = {
    connectionName: "signal",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [{ x: 10, y: 0 }],
    route: [
      ...Array.from({ length: 11 }, (_, x) => ({ x, y: 0, z: 0 })),
      ...Array.from({ length: 10 }, (_, i) => ({ x: i + 10, y: 0, z: 1 })),
    ],
  }
  const directions = [signal, { ...signal, route: [...signal.route].reverse() }]
  for (const route of directions) {
    const original = structuredClone([route, fixed])
    const solver = new TraceWidthSolver({
      hdRoutes: [route],
      connection: [
        { name: "signal", nominalTraceWidth: 0.22, pointsToConnect: [] },
      ],
      minTraceWidth: 0.1,
      obstacleMargin: 0.1,
      layerCount: 2,
    })
    solver.solve()
    const [refined] = solver.refineWidths({
      hdRoutes: [route],
      otherHdRoutes: [fixed],
    })
    const { wireSegments } = getPipeline9RouteCopperGeometry(refined!, {
      layerCount: 2,
    })
    const exportedRoute = convertHdRouteToSimplifiedRoute(refined!, 2)
    expect([route, fixed]).toEqual(original)
    expect(refined!.vias).toEqual(signal.vias)
    expect(
      doPipeline9RoutesHaveCopperConflict({
        left: refined!,
        right: fixed,
        clearance: 0.1,
        layerCount: 2,
      }),
    ).toBe(false)
    for (const x of [4.5, 12.5]) {
      const segment = wireSegments.find(
        ({ start, end }) =>
          Math.min(start.x, end.x) < x && x < Math.max(start.x, end.x),
      )
      expect(segment!.width).toBe(0.1)
    }
    for (const point of exportedRoute) {
      if (point.route_type === "wire" && [0, 10, 19].includes(point.x)) {
        expect(point.width).toBe(0.1)
      }
    }
    for (const layer of ["top", "bottom"]) {
      expect(
        exportedRoute.some(
          (point) =>
            point.route_type === "wire" &&
            point.layer === layer &&
            point.width === 0.22,
        ),
      ).toBe(true)
    }
  }
})
