import { expect, test } from "bun:test"
import { CollectiveClearanceSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/CollectiveClearanceSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("an exhausted collective branch policy explicitly retains the original candidate without projection fallback", (): void => {
  const routes: HighDensityRoute[] = [0, 0.15].map((y, index) => ({
    connectionName: `net_${index}`, traceThickness: 0.1, viaDiameter: 0.3,
    route: [{ x: -1, y, z: 0 }, { x: 0, y, z: 0 }, { x: 1, y, z: 0 }], vias: [],
  }))
  const solver = new CollectiveClearanceSolver({
    srj: {
      layerCount: 1, minTraceWidth: 0.1,
      bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
      obstacles: [], connections: [],
    },
    routes, bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 }, boundaryMargin: 0,
    lockedPointIndices: routes.map((route): boolean[] => route.route.map((): boolean => false)),
  }, { branches: 0, vertices: 128, constraintChecks: 1000 })
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.getOutput()).toEqual(routes)
  expect(Number(solver.stats.unknownComponents)).toBeGreaterThan(0)
  expect(solver.stats.nativeProjectionSweeps).toBe(0)
  expect(solver.stats.constraintChecks).toBe(0)
  expect(solver.stats.branches).toBe(0)
})
