import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SameNetViaMergerSolver } from "lib/solvers/SameNetViaMergerSolver/SameNetViaMergerSolver"

test("SameNetViaMergerSolver throws when a via has no route transition", () => {
  const solver = new SameNetViaMergerSolver({
    inputHdRoutes: [
      {
        connectionName: "route-a",
        traceThickness: 0.15,
        viaDiameter: 0.3,
        route: [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
        ],
        vias: [{ x: 0, y: 0 }],
      },
      {
        connectionName: "route-b",
        traceThickness: 0.15,
        viaDiameter: 0.3,
        route: [
          { x: 0.4, y: 0, z: 0 },
          { x: 0.4, y: 0, z: 1 },
        ],
        vias: [{ x: 0.4, y: 0 }],
      },
    ],
    obstacles: [],
    colorMap: {},
    layerCount: 2,
    connMap: new ConnectivityMap({ net0: ["route-a", "route-b"] }),
  })

  expect(() => solver._step()).toThrow(
    "SameNetViaMergerSolver could not find transition layers for via at (0, 0)",
  )
})
