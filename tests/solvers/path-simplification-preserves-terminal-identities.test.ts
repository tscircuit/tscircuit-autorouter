import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SingleSimplifiedPathSolver5 } from "lib/solvers/SimplifiedPathSolver/SingleSimplifiedPathSolver5_Deg45"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("path sampling retains terminal point identities in both directions", (): void => {
  const points: HighDensityRoute["route"] = [
    { x: 0, y: 0, z: 1, pcb_port_id: "start" },
    { x: 1, y: 1, z: 1 },
    { x: 2, y: 0, z: 1, pcb_port_id: "end" },
  ]
  for (const reverse of [false, true]) {
    const route: HighDensityRoute = {
      connectionName: "terminal_route",
      traceThickness: 0.15,
      viaDiameter: 0.3,
      vias: [],
      route: reverse ? [...points].reverse() : points,
    }
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

    expect(solver.failed).toBeFalse()
    expect(solver.simplifiedRoute.route[0]).toEqual(route.route[0])
    expect(solver.simplifiedRoute.route.at(-1)).toEqual(route.route.at(-1))
    expect(
      solver.simplifiedRoute.route.every((point): boolean => point.y === 0),
    ).toBeTrue()
  }
})
