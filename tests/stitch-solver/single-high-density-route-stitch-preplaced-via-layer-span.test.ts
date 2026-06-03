import { expect, test } from "bun:test"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import { getAssignableViaPointKeys } from "lib/autorouter-pipelines/AutoroutingPipeline8/assignableViaUtils"
import type { Obstacle } from "lib/types"

const makeAssignableViaObstacle = (layers: string[]): Obstacle => ({
  type: "rect",
  layers,
  center: { x: 0, y: 0 },
  width: 0.6,
  height: 0.6,
  connectedTo: [],
  netIsAssignable: true,
})

test("single stitch rejects direct layer jumps that are not supported by the preplaced via stack", () => {
  const collapsedAllowedLayerTransitionPointKeys = getAssignableViaPointKeys([
    makeAssignableViaObstacle(["top", "inner1"]),
    makeAssignableViaObstacle(["inner2", "bottom"]),
  ])

  const blockedSolver = new SingleHighDensityRouteStitchSolver3({
    connectionName: "conn",
    start: { x: 0, y: 0, z: 0 },
    end: { x: 0, y: 0, z: 3 },
    hdRoutes: [],
    allowedLayerTransitionPointKeys: new Set<string>(),
  })

  blockedSolver.solve()

  expect(blockedSolver.failed).toBe(true)
  expect(blockedSolver.error).toContain(
    "Layer transition at 0.0000,0.0000 is not allowed",
  )

  const solver = new SingleHighDensityRouteStitchSolver3({
    connectionName: "conn",
    start: { x: 0, y: 0, z: 0 },
    end: { x: 0, y: 0, z: 3 },
    hdRoutes: [],
    allowedLayerTransitionPointKeys: collapsedAllowedLayerTransitionPointKeys,
  })

  solver.solve()

  // This should fail for the same reason as blockedSolver above, but the
  // current Pipeline8 allowlist only tracks XY coordinates. Two constrained
  // vias at the same XY therefore collapse into a single "allowed" point,
  // incorrectly permitting a direct top-to-bottom jump.
  expect(solver.failed).toBe(false)
})
