import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SameNetViaMergerSolver } from "lib/solvers/SameNetViaMergerSolver/SameNetViaMergerSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("same-net via merging moves each repeated physical via once", (): void => {
  for (const transitionCount of [2, 3]) {
    const repeatedRoute: HighDensityRoute = {
      connectionName: "repeated",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [{ x: 0.2, y: -1, z: 0 }],
      vias: [],
    }
    for (let index = 0; index < transitionCount; index++) {
      const fromZ = index % 2
      const toZ = 1 - fromZ
      repeatedRoute.route.push(
        { x: 0.2, y: 0, z: fromZ },
        { x: 0.2, y: 0, z: toZ },
        { x: 0.7, y: 1, z: toZ },
      )
      repeatedRoute.vias.push({ x: 0.2, y: 0 })
    }
    const inputHdRoutes: HighDensityRoute[] = [
      {
        connectionName: "anchor",
        traceThickness: 0.1,
        viaDiameter: 0.3,
        route: [
          { x: -1, y: 0, z: 0 },
          { x: 0, y: 0, z: 0 },
          { x: 0, y: 0, z: 1 },
          { x: -1, y: 0, z: 1 },
        ],
        vias: [{ x: 0, y: 0 }],
      },
      repeatedRoute,
    ]
    const originalRoutes = structuredClone(inputHdRoutes)
    const solver = new SameNetViaMergerSolver({
      inputHdRoutes,
      obstacles: [],
      colorMap: {},
      layerCount: 2,
      connMap: new ConnectivityMap({ net: ["anchor", "repeated"] }),
    })

    solver.solve()

    expect(solver.solved).toBeTrue()
    expect(solver.failed).toBeFalse()
    expect(solver.getMergedViaHdRoutes()).toEqual([
      originalRoutes[0]!,
      {
        ...repeatedRoute,
        route: repeatedRoute.route.map((point) =>
          point.x === 0.2 && point.y === 0 ? { ...point, x: 0 } : point,
        ),
        vias: [{ x: 0, y: 0 }],
      },
    ])
    expect(inputHdRoutes).toEqual(originalRoutes)
    expect(solver.stats.mergedViaCount).toBe(1)
  }
})
