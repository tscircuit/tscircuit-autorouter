import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SameNetViaMergerSolver } from "lib/solvers/SameNetViaMergerSolver/SameNetViaMergerSolver"

test("same-net via merging handles repeated layer transitions at one location", () => {
  const solver = new SameNetViaMergerSolver({
    inputHdRoutes: [
      {
        connectionName: "anchor",
        traceThickness: 0.1,
        viaDiameter: 0.3,
        route: [
          { x: 0, y: 0, z: 0 },
          { x: 0, y: 0, z: 1 },
          { x: 0, y: 0, z: 2 },
        ],
        vias: [{ x: 0, y: 0 }],
      },
      {
        connectionName: "stacked",
        traceThickness: 0.1,
        viaDiameter: 0.3,
        route: [
          { x: 0.2, y: 0, z: 0 },
          { x: 0.2, y: 0, z: 1 },
          { x: 0.2, y: 0, z: 2 },
        ],
        vias: [
          { x: 0.2, y: 0 },
          { x: 0.2, y: 0 },
        ],
      },
    ],
    obstacles: [],
    colorMap: {},
    layerCount: 4,
    connMap: new ConnectivityMap({ net: ["anchor", "stacked"] }),
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  const routes = solver.getMergedViaHdRoutes()!
  expect(routes[1]!.route).toEqual([
    { x: 0, y: 0, z: 0 },
    { x: 0, y: 0, z: 1 },
    { x: 0, y: 0, z: 2 },
  ])
  expect(routes[1]!.vias).toEqual([{ x: 0, y: 0 }])
})
