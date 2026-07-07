import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SameNetViaMergerSolver } from "lib/solvers/SameNetViaMergerSolver/SameNetViaMergerSolver"

test("SameNetViaMergerSolver does not merge through a sibling same-net route", () => {
  const solver = new SameNetViaMergerSolver({
    inputHdRoutes: [
      {
        connectionName: "route-a",
        traceThickness: 0.15,
        viaDiameter: 0.45,
        route: [
          { x: -1, y: 0, z: 0 },
          { x: 0, y: 0, z: 0 },
          { x: 0, y: 0, z: 1 },
          { x: 0, y: 0.6, z: 1 },
          { x: 0, y: 0.6, z: 0 },
          { x: 1, y: 0.6, z: 0 },
        ],
        vias: [
          { x: 0, y: 0 },
          { x: 0, y: 0.6 },
        ],
      },
      {
        connectionName: "route-b",
        traceThickness: 0.15,
        viaDiameter: 0.45,
        route: [
          { x: -0.2, y: 0.3, z: 0 },
          { x: 0.2, y: 0.3, z: 0 },
        ],
        vias: [],
      },
    ],
    obstacles: [],
    colorMap: {},
    layerCount: 2,
    connMap: new ConnectivityMap({ net0: ["route-a", "route-b"] }),
  })

  solver.solve()

  const routes = solver.getMergedViaHdRoutes()
  if (!routes) {
    throw new Error("Expected SameNetViaMergerSolver to emit merged routes")
  }

  expect(routes[0].vias).toEqual([
    { x: 0, y: 0 },
    { x: 0, y: 0.6 },
  ])
})
