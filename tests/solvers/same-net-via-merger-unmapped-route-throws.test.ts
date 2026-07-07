import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SameNetViaMergerSolver } from "lib/solvers/SameNetViaMergerSolver/SameNetViaMergerSolver"

test("SameNetViaMergerSolver throws when a via route is missing from connMap", () => {
  expect(
    () =>
      new SameNetViaMergerSolver({
        inputHdRoutes: [
          {
            connectionName: "route-a",
            traceThickness: 0.15,
            viaDiameter: 0.3,
            route: [
              { x: 0, y: 0, z: 0 },
              { x: 0, y: 0, z: 1 },
            ],
            vias: [{ x: 0, y: 0 }],
          },
        ],
        obstacles: [],
        colorMap: {},
        layerCount: 2,
        connMap: new ConnectivityMap({ net0: ["route-b"] }),
      }),
  ).toThrow('SameNetViaMergerSolver could not find net for route "route-a"')
})
