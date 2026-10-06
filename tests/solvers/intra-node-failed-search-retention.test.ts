import { expect, test } from "bun:test"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

const nodeWithPortPoints: NodeWithPortPoints = {
  capacityMeshNodeId: "failed-search-retention",
  center: { x: 0, y: 0 },
  width: 2,
  height: 2,
  portPoints: [],
}

test("production intra-node routing releases a failed grid search", () => {
  const solver = new IntraNodeRouteSolver({
    nodeWithPortPoints,
    captureSearchDebug: false,
  })
  const failedSearch = new SingleHighDensityRouteSolver({
    connectionName: "failed-connection",
    obstacleRoutes: [],
    minDistBetweenEnteringPoints: 1,
    bounds: { minX: -1, minY: -1, maxX: 1, maxY: 1 },
    A: { x: -1, y: 0, z: 0 },
    B: { x: 1, y: 0, z: 0 },
    captureSearchDebug: false,
  })
  failedSearch.solved = false
  failedSearch.failed = true
  failedSearch.error = "expected failure"
  solver.activeSubSolver = failedSearch
  solver.MAX_ITERATIONS = 10

  solver.step()

  expect(solver.failed).toBe(true)
  expect(solver.error).toBe("expected failure")
  expect(solver.activeSubSolver).toBeNull()
  expect(solver.failedSubSolvers).toEqual([])

  const debugSolver = new IntraNodeRouteSolver({
    nodeWithPortPoints,
    captureSearchDebug: true,
  })
  debugSolver.activeSubSolver = failedSearch
  debugSolver.MAX_ITERATIONS = 10

  debugSolver.step()

  expect(debugSolver.failedSubSolvers).toEqual([failedSearch])
})
