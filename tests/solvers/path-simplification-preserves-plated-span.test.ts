import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SingleSimplifiedPathSolver5 } from "lib/solvers/SimplifiedPathSolver/SingleSimplifiedPathSolver5_Deg45"
import type { HighDensityRoute } from "lib/types/high-density-types"

type RoutePoint = HighDensityRoute["route"][number]

test("path simplification preserves plated spans between simplifiable wires", (): void => {
  for (const [endX, leading, reverse] of [
    [0, false, false],
    [0, false, true],
    [0.2, false, false],
    [0.2, false, true],
    [0.6, false, false],
    [0.6, false, true],
    [0.6, true, false],
    [0.6, true, true],
  ] as const) {
    const platedStart: RoutePoint = {
      x: 0,
      y: 0,
      z: 0,
      toNextSegmentType: "through_obstacle",
      toNextSegmentCircuitJsonMetadata: { pcb_plated_hole_id: "plated_a" },
    }
    const platedEnd: RoutePoint = { x: endX, y: 0, z: 1 }
    const points: RoutePoint[] = [
      ...(leading
        ? []
        : [
            { x: -2, y: 0, z: 0, pcb_port_id: "start" },
            { x: -1, y: 0.5, z: 0 },
          ]),
      platedStart,
      platedEnd,
      { x: endX + 1, y: 0.5, z: 1 },
      { x: endX + 2, y: 0, z: 1, pcb_port_id: "end" },
    ]
    const expectedPlatedStart: RoutePoint = reverse
      ? {
          ...platedEnd,
          toNextSegmentType: platedStart.toNextSegmentType,
          toNextSegmentCircuitJsonMetadata:
            platedStart.toNextSegmentCircuitJsonMetadata,
        }
      : platedStart
    const expectedPlatedEnd: RoutePoint = reverse
      ? { x: platedStart.x, y: platedStart.y, z: platedStart.z }
      : platedEnd
    const route: HighDensityRoute = {
      connectionName: "plated_route",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      vias: [],
      route: reverse
        ? [...points].reverse().map((point): RoutePoint => {
            if (point === platedEnd) return expectedPlatedStart
            if (point === platedStart) return expectedPlatedEnd
            return point
          })
        : points,
    }
    const snapshot: HighDensityRoute = structuredClone(route)
    const solver: SingleSimplifiedPathSolver5 = new SingleSimplifiedPathSolver5(
      {
        inputRoute: route,
        otherHdRoutes: [],
        obstacles: [],
        connMap: new ConnectivityMap({}),
        colorMap: {},
      },
    )
    solver.solve()
    const output: HighDensityRoute = solver.simplifiedRoute
    const transitions: RoutePoint[][] = output.route
      .slice(1)
      .flatMap((point, index): RoutePoint[][] =>
        point.z === output.route[index]!.z
          ? []
          : [[output.route[index]!, point]],
      )

    expect(solver.failed).toBeFalse()
    expect(transitions).toEqual([[expectedPlatedStart, expectedPlatedEnd]])
    expect(output.vias).toEqual([])
    expect(output.route[0]).toEqual(route.route[0])
    expect(output.route.at(-1)).toEqual(route.route.at(-1))
    const outputWireLength: number = output.route
      .slice(1)
      .reduce(
        (length, point, index): number =>
          point.z === output.route[index]!.z
            ? length +
              Math.hypot(
                point.x - output.route[index]!.x,
                point.y - output.route[index]!.y,
              )
            : length,
        0,
      )
    expect(outputWireLength).toBeLessThan(
      (leading ? 2 : 4) * Math.hypot(1, 0.5),
    )
    expect(route).toEqual(snapshot)
  }
})
