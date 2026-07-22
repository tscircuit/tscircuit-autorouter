import { expect, test } from "bun:test"
import { getXyPointKey } from "lib/autorouter-pipelines/AutoroutingPipeline8/getXyPointKey"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

const makeRoute = (
  connectionName: string,
  route: Array<{ x: number; y: number; z: number }>,
  vias: Array<{ x: number; y: number }> = [],
): HighDensityIntraNodeRoute => ({
  connectionName,
  rootConnectionName: "root",
  traceThickness: 0.1,
  viaDiameter: 0.3,
  route,
  vias,
  jumpers: [],
})

test("stitch ordering avoids a layer-stranding branch", () => {
  const branchTransition = { x: 1, y: 0 }
  const solver = new SingleHighDensityRouteStitchSolver3({
    connectionName: "candidate",
    start: { x: 0, y: 0, z: 0 },
    end: { x: 3, y: 0, z: 0 },
    hdRoutes: [
      makeRoute("first", [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
      ]),
      makeRoute(
        "dead_end_branch",
        [
          { ...branchTransition, z: 0 },
          { ...branchTransition, z: 1 },
          { x: 1, y: 1, z: 1 },
        ],
        [branchTransition],
      ),
      makeRoute("terminal_path", [
        { x: 1.2, y: 0, z: 0 },
        { x: 3, y: 0, z: 0 },
      ]),
    ],
    allowedLayerTransitionPointKeys: new Set([
      getXyPointKey(branchTransition),
    ]),
    isValidStitchSegment: () => true,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.mergedHdRoute.route.at(-1)).toMatchObject({
    x: 3,
    y: 0,
    z: 0,
  })
  expect(solver.mergedHdRoute.route.some((point) => point.z === 1)).toBe(false)
})
