import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SingleSimplifiedPathSolver5 } from "lib/solvers/SimplifiedPathSolver/SingleSimplifiedPathSolver5_Deg45"
import type { HighDensityRoute } from "lib/types/high-density-types"

type RoutePoint = HighDensityRoute["route"][number]

test("path simplification preserves terminal vias as copper in either direction", (): void => {
  const routeCases: RoutePoint[][] = [
    [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 0, z: 1 },
    ],
    [
      { x: -1, y: 0, z: 0 },
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 0, z: 1 },
    ],
    [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }],
    [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 2 },
      { x: 1, y: 0, z: 2 },
    ],
  ]
  for (const points of routeCases) {
    for (const reverse of [false, true]) {
      const route: HighDensityRoute = {
        connectionName: "terminal_route",
        traceThickness: 0.15,
        viaDiameter: 0.3,
        route: reverse ? [...points].reverse() : points,
        vias: [{ x: 0, y: 0 }],
      }
      const snapshot: HighDensityRoute = structuredClone(route)
      const connMap: ConnectivityMap = new ConnectivityMap({
        terminal_net: [route.connectionName],
        foreign_net: ["foreign_route"],
      })
      const solver: SingleSimplifiedPathSolver5 =
        new SingleSimplifiedPathSolver5({
          inputRoute: route,
          otherHdRoutes: [],
          obstacles: [],
          connMap,
          colorMap: {},
        })
      solver.solve()
      const output: HighDensityRoute = solver.simplifiedRoute
      expect(solver.failed).toBeFalse()
      expect(output.route[0]).toEqual(route.route[0])
      expect(output.route.at(-1)).toEqual(route.route.at(-1))
      expect(output.vias).toEqual([{ x: 0, y: 0 }])
      const transitions: RoutePoint[][] = output.route.slice(1).flatMap(
        (point, index): RoutePoint[][] =>
          point.z === output.route[index]!.z
            ? []
            : [[output.route[index]!, point]],
      )
      expect(transitions).toHaveLength(1)
      expect(transitions[0]!.map((point) => point.z)).toEqual(
        reverse
          ? [points.at(-1)!.z, points[0]!.z]
          : [points[0]!.z, points.at(-1)!.z],
      )
      const foreignRoute: HighDensityRoute = {
        connectionName: "foreign_route",
        traceThickness: 0.15,
        viaDiameter: 0.3,
        route: [
          { x: 0, y: -1, z: 0 },
          { x: 0, y: 1, z: 0 },
        ],
        vias: [],
      }
      const peerSolver: SingleSimplifiedPathSolver5 =
        new SingleSimplifiedPathSolver5({
          inputRoute: foreignRoute,
          otherHdRoutes: [output],
          obstacles: [],
          connMap,
          colorMap: {},
        })
      expect(
        peerSolver.isValidPathSegment(
          foreignRoute.route[0]!,
          foreignRoute.route[1]!,
        ),
      ).toBeFalse()
      expect(route).toEqual(snapshot)
    }
  }

  for (const endX of [0, 0.2]) {
    const platedRoute: HighDensityRoute = {
      connectionName: "plated_terminal",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      route: [
        { x: 0, y: 0, z: 0, toNextSegmentType: "through_obstacle" },
        { x: endX, y: 0, z: 1 },
      ],
      vias: [],
    }
    const platedSolver: SingleSimplifiedPathSolver5 =
      new SingleSimplifiedPathSolver5({
        inputRoute: platedRoute,
        otherHdRoutes: [],
        obstacles: [],
        connMap: new ConnectivityMap({}),
        colorMap: {},
      })
    platedSolver.solve()
    expect(platedSolver.failed).toBeFalse()
    expect(platedSolver.simplifiedRoute.route).toEqual(platedRoute.route)
    expect(platedSolver.simplifiedRoute.vias).toEqual([])
  }
})
