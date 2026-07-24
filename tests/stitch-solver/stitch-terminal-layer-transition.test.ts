import { expect, test } from "bun:test"
import { getXyPointKey } from "lib/autorouter-pipelines/AutoroutingPipeline8/getXyPointKey"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

const fragment: HighDensityIntraNodeRoute = {
  connectionName: "conn",
  traceThickness: 0.15,
  viaDiameter: 0.3,
  route: [
    { x: 0, y: 0, z: 0 },
    { x: 0.1, y: 0, z: 0 },
  ],
  vias: [],
}

test("validated terminal completion can end with an allowed layer transition", () => {
  const terminal = { x: 2, y: 0, z: 1 }
  const solver = new SingleHighDensityRouteStitchSolver3({
    connectionName: "conn",
    start: { x: 0, y: 0, z: 0 },
    end: terminal,
    hdRoutes: [fragment],
    allowedLayerTransitionPointKeys: new Set([getXyPointKey(terminal)]),
    isValidStitchSegment: () => true,
  })

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.mergedHdRoute.route).toEqual([
    { x: 0, y: 0, z: 0 },
    { x: 0.1, y: 0, z: 0 },
    { x: 2, y: 0, z: 0 },
    { x: 2, y: 0, z: 1 },
  ])
  expect(solver.mergedHdRoute.vias).toEqual([{ x: 2, y: 0 }])
})
