import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SameNetViaMergerSolver } from "lib/solvers/SameNetViaMergerSolver/SameNetViaMergerSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

const makeRoute = (
  connectionName: string,
  x: number,
  z: number,
): HighDensityRoute => ({
  connectionName,
  traceThickness: 0.1,
  viaDiameter: 0.3,
  route: [
    { x: x - 1, y: -1, z },
    { x, y: 0, z },
    { x, y: 0, z: z + 1 },
    { x: x + 1, y: 1, z: z + 1 },
  ],
  vias: [{ x, y: 0 }],
})

test("shared drill sites merge only when every attached route can move", () => {
  for (const blocked of [true, false]) {
    const routes = [
      makeRoute("site-a", 0, 2),
      makeRoute("site-b", 0.6, 2),
      makeRoute("shared-a", 0, 0),
    ]
    const solver = new SameNetViaMergerSolver({
      inputHdRoutes: routes,
      obstacles: blocked
        ? [
            {
              type: "rect",
              center: { x: 0.3, y: 0 },
              width: 0.1,
              height: 0.1,
              layers: ["inner2"],
              connectedTo: ["foreign-pad"],
            },
          ]
        : [],
      colorMap: {},
      layerCount: 4,
      connMap: new ConnectivityMap({
        net0: ["site-a", "site-b", "shared-a"],
      }),
    })

    // The blocked shared route used to alternate between the two surviving
    // sites indefinitely. A complete-site merge either reduces sites or stops.
    for (let step = 0; step < routes.length && !solver.solved; step++) {
      solver.step()
    }
    expect(solver.solved).toBeTrue()
    expect(solver.failed).toBeFalse()
    const output = solver.getMergedViaHdRoutes()!
    const sites = new Set(
      output.flatMap((route) => route.vias.map((via) => `${via.x}:${via.y}`)),
    )
    expect(sites.size).toBe(blocked ? 2 : 1)
    if (blocked) expect(output).toEqual(routes)
  }
})
