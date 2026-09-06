import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SingleSimplifiedPathSolver5 } from "lib/solvers/SimplifiedPathSolver/SingleSimplifiedPathSolver5_Deg45"
import type { HighDensityRoute } from "lib/types/high-density-types"

type RoutePoint = HighDensityRoute["route"][number]

test("path simplification preserves taper anchors and simplifies uniform copper", (): void => {
  const taperedPoints: RoutePoint[] = [
    { x: -3, y: 0, z: 0, traceThickness: 0.15, pcb_port_id: "start" },
    { x: -2.5, y: 0, z: 0, traceThickness: 0.15 },
    { x: -2, y: 0.2, z: 0, traceThickness: 0.3 },
    { x: -1, y: 0, z: 0, traceThickness: 0.6 },
    { x: 0, y: 1, z: 0, traceThickness: 0.6 },
    { x: 1, y: 0, z: 0, traceThickness: 0.6 },
    { x: 2, y: 0.2, z: 0, traceThickness: 0.3 },
    { x: 2.5, y: 0, z: 0, traceThickness: 0.15 },
    { x: 3, y: 0, z: 0, traceThickness: 0.15, pcb_port_id: "end" },
  ]
  for (const reverse of [false, true]) {
    const points: RoutePoint[] = reverse
      ? [...taperedPoints].reverse()
      : taperedPoints
    const route: HighDensityRoute = {
      connectionName: "tapered_route",
      traceThickness: 0.6,
      viaDiameter: 0.3,
      vias: [],
      route: points,
    }
    const snapshot: HighDensityRoute = structuredClone(route)
    const solver: SingleSimplifiedPathSolver5 =
      new SingleSimplifiedPathSolver5({
        inputRoute: route,
        otherHdRoutes: [],
        obstacles: [],
        connMap: new ConnectivityMap({}),
        colorMap: {},
        useTraceWidthAwareClearance: true,
      })
    solver.solve()
    const output: HighDensityRoute = solver.simplifiedRoute
    expect(solver.failed).toBeFalse()
    expect(output.route[0]).toEqual(points[0])
    expect(output.route.at(-1)).toEqual(points.at(-1))
    for (let index: number = 1; index < points.length; index++) {
      const before: RoutePoint = points[index - 1]!
      const after: RoutePoint = points[index]!
      if (before.traceThickness === after.traceThickness) continue
      expect(
        output.route.some((point, outputIndex): boolean => {
          const next: RoutePoint | undefined = output.route[outputIndex + 1]
          return (
            point.x === before.x &&
            point.y === before.y &&
            point.traceThickness === before.traceThickness &&
            next?.x === after.x &&
            next.y === after.y &&
            next.traceThickness === after.traceThickness
          )
        }),
      ).toBeTrue()
    }
    expect(
      output.route.some((point): boolean => point.x === 0 && point.y === 1),
    ).toBeFalse()
    expect(route).toEqual(snapshot)
  }

  for (const width of [0.3, 0.6]) {
    const route: HighDensityRoute = {
      connectionName: "uniform_route",
      traceThickness: 0.6,
      viaDiameter: 0.3,
      vias: [],
      route: [
        { x: -1, y: 0, z: 0, traceThickness: width },
        { x: 0, y: 1, z: 0, traceThickness: width },
        { x: 1, y: 0, z: 0, traceThickness: width },
      ],
    }
    const solver: SingleSimplifiedPathSolver5 =
      new SingleSimplifiedPathSolver5({
        inputRoute: route,
        otherHdRoutes: [],
        obstacles: [],
        connMap: new ConnectivityMap({}),
        colorMap: {},
        useTraceWidthAwareClearance: true,
      })
    solver.solve()
    expect(solver.failed).toBeFalse()
    expect(
      solver.simplifiedRoute.route.every(
        (point): boolean => point.y === 0 && point.traceThickness === width,
      ),
    ).toBeTrue()
  }
})
