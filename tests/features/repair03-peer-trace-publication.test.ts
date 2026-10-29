import { expect, test } from "bun:test"
import { segmentToSegmentMinDistance } from "@tscircuit/math-utils"
import {
  GlobalDrcForceImproveSolver,
  type HighDensityRoute,
  type SimpleRouteJson,
} from "high-density-repair03/lib"

test("the installed repair03 cannot replace a clearance error with a new peer short", (): void => {
  const hdRoutes: HighDensityRoute[] = [
    [0.2, 0.4],
    [0.4, 0.3],
    [0.6, 0.4],
    [0.8, 0.5],
  ].map(([terminalY, bendY], index) => ({
    connectionName: `signal_${index + 1}`,
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: [
      { x: 0, y: terminalY!, z: 0 },
      { x: 2, y: bendY!, z: 0 },
      { x: 3, y: terminalY!, z: 0 },
    ],
  }))
  const srj: SimpleRouteJson = {
    bounds: { minX: -1, minY: -1, maxX: 4, maxY: 2 },
    layerCount: 2,
    minTraceWidth: 0.1,
    minViaDiameter: 0.3,
    obstacles: [],
    connections: hdRoutes.map((route) => ({
      name: route.connectionName,
      pointsToConnect: [],
    })),
  }
  const original = structuredClone(hdRoutes)
  const solver = new GlobalDrcForceImproveSolver({
    srj,
    hdRoutes,
    maxIterations: 16,
    enableLargeBoardBroadFallback: false,
    enablePostSolveClearanceRelaxation: false,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.stats.finalDrcIssueCount).toBeLessThanOrEqual(5)
  expect(hdRoutes).toEqual(original)
  const output = solver.getOutput()
  const left = output.find((route) => route.connectionName === "signal_1")!
  const right = output.find((route) => route.connectionName === "signal_4")!
  for (let i = 1; i < left.route.length; i++) {
    for (let j = 1; j < right.route.length; j++) {
      const gap =
        segmentToSegmentMinDistance(
          left.route[i - 1]!,
          left.route[i]!,
          right.route[j - 1]!,
          right.route[j]!,
        ) -
        (left.traceThickness + right.traceThickness) / 2
      expect(gap).toBeGreaterThanOrEqual(-1e-9)
    }
  }
})
