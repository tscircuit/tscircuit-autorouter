import { expect, test } from "bun:test"
import {
  GlobalDrcForceImproveSolver,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "high-density-repair03/lib"

test("the installed repair03 preserves disjoint blind-via copper without false DRC", (): void => {
  const routes: HighDensityRoute[] = [
    {
      connectionName: "upper",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [{ x: 0, y: 0 }],
      route: [
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
      ],
    },
    {
      connectionName: "lower",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      vias: [{ x: 0.2, y: 0 }],
      route: [
        { x: 0.2, y: 0, z: 2 },
        { x: 0.2, y: 0, z: 3 },
      ],
    },
  ]
  const srj: SimpleRouteJson = {
    bounds: { minX: -1, minY: -1, maxX: 1, maxY: 1 },
    layerCount: 4,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    obstacles: [],
    connections: routes.map((route) => ({
      name: route.connectionName,
      pointsToConnect: [],
    })),
  }
  const original = structuredClone(routes)
  for (const allowBlindAndBuriedVias of [true, false, undefined]) {
    const solver = new GlobalDrcForceImproveSolver({
      srj: { ...srj, allowBlindAndBuriedVias },
      hdRoutes: routes,
      maxIterations: 4,
      enableBroadFallback: false,
      enableLargeBoardBroadFallback: false,
      enablePostSolveClearanceRelaxation: false,
    })
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(solver.stats.initialDrcIssueCount).toBe(
      allowBlindAndBuriedVias ? 0 : 1,
    )
    expect(solver.stats.finalDrcIssueCount).toBe(
      allowBlindAndBuriedVias ? 0 : 1,
    )
    expect(solver.getOutput()).toEqual(original)
    expect(routes).toEqual(original)
  }
})
