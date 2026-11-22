import { expect, test } from "bun:test"
import { widenClearInteriorSegments } from "lib/solvers/TraceWidthSolver/widenClearInteriorSegments"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("interior widening respects the copper margin at a board cutout", (): void => {
  const board: SimpleRouteJson = {
    bounds: { minX: -1, maxX: 11, minY: -1, maxY: 2 },
    outline: [
      { x: -1, y: -1 },
      { x: 11, y: -1 },
      { x: 11, y: 2 },
      { x: 7, y: 2 },
      { x: 7, y: 0.15 },
      { x: 4, y: 0.15 },
      { x: 4, y: 2 },
      { x: -1, y: 2 },
    ],
    minBoardEdgeClearance: 0.08,
    connections: [],
    obstacles: [],
    layerCount: 2,
    minTraceWidth: 0.1,
  }
  const route: HighDensityRoute = {
    connectionName: "signal",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    vias: [],
    route: Array.from({ length: 11 }, (_, x) => ({ x, y: 0, z: 0 })),
  }
  const refined = widenClearInteriorSegments({
    board,
    route,
    nominalWidth: 0.22,
    hasClearance: () => true,
  })
  const nearCutout = refined.route.filter(({ x }) => x >= 4 && x <= 7)
  for (const point of nearCutout) {
    expect(point.traceThickness ?? refined.traceThickness).toBe(0.1)
  }
  expect(refined.route.some((point) => point.traceThickness === 0.22)).toBe(true)
})
