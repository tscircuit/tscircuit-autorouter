import { expect, test } from "bun:test"
import { CollectiveClearanceSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/CollectiveClearanceSolver"
import { segmentToSegmentMinDistance } from "@tscircuit/math-utils"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("a separating normal clears long parallel diagonal spans whose axis side domains are all empty", (): void => {
  const offset = 0.15 / Math.SQRT2
  const routes: HighDensityRoute[] = [0, 1].map((index) => ({
    connectionName: `net_${index}`, traceThickness: 0.1, viaDiameter: 0.3,
    route: [-10, -4, 4, 10].map((coordinate) => ({
      x: coordinate - index * offset, y: coordinate + index * offset, z: 0,
    })), vias: [],
  }))
  const required = 0.2
  for (const axis of ["x", "y"] as const) for (const reverse of [false, true]) {
    const a = routes[reverse ? 1 : 0]!.route.slice(1, 3)
    const b = routes[reverse ? 0 : 1]!.route.slice(1, 3)
    // Even independent maximum +/-0.25 endpoint motion cannot establish an
    // axis separating side for the complete long diagonal endpoint intervals.
    const largestPossibleGap = Math.min(...b.map((point): number => point[axis])) - Math.max(...a.map((point): number => point[axis])) + 0.5
    expect(largestPossibleGap).toBeLessThan(required)
  }
  const solver = new CollectiveClearanceSolver({
    srj: {
      layerCount: 1, minTraceWidth: 0.1,
      bounds: { minX: -12, minY: -12, maxX: 12, maxY: 12 }, obstacles: [], connections: [],
    },
    routes, bounds: { minX: -12, minY: -12, maxX: 12, maxY: 12 }, boundaryMargin: 0,
    lockedPointIndices: routes.map((route): boolean[] => route.route.map((): boolean => false)),
  })
  solver.solve()
  expect(solver.failed).toBe(false)
  const output = solver.getOutput()
  expect(segmentToSegmentMinDistance(output[0]!.route[1]!, output[0]!.route[2]!, output[1]!.route[1]!, output[1]!.route[2]!)).toBeGreaterThanOrEqual(required)
  expect(Number(solver.stats.solvedComponents)).toBeGreaterThan(0)
  expect(Number(solver.stats.witnessChecks)).toBeGreaterThan(0)
  for (let index = 0; index < routes.length; index++) {
    expect(output[index]!.route[0]).toEqual(routes[index]!.route[0])
    expect(output[index]!.route.at(-1)).toEqual(routes[index]!.route.at(-1))
    for (let point = 0; point < routes[index]!.route.length; point++) {
      expect(Math.abs(output[index]!.route[point]!.x - routes[index]!.route[point]!.x)).toBeLessThanOrEqual(0.25)
      expect(Math.abs(output[index]!.route[point]!.y - routes[index]!.route[point]!.y)).toBeLessThanOrEqual(0.25)
    }
  }
})
