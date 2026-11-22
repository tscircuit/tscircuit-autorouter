import { expect, test } from "bun:test"
import { widenClearInteriorSegments } from "lib/solvers/TraceWidthSolver/widenClearInteriorSegments"
import type { SimpleRouteJson } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("interior widening respects the copper margin at a board cutout", (): void => {
  const board: SimpleRouteJson = {
    bounds: { minX: -6, maxX: 15, minY: -1, maxY: 2 },
    outline: [
      { x: -6, y: -1 },
      { x: 15, y: -1 },
      { x: 15, y: 2 },
      { x: 7, y: 2 },
      { x: 7, y: 0.15 },
      { x: 4, y: 0.15 },
      { x: 4, y: 2 },
      { x: -6, y: 2 },
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
    route: Array.from({ length: 20 }, (_, index) => ({
      x: index - 5,
      y: 0,
      z: 0,
    })),
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
  for (const x of [-2, 11]) {
    expect(refined.route.find((point) => point.x === x)?.traceThickness).toBe(
      0.22,
    )
  }
})
