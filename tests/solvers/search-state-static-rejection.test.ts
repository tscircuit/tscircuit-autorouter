import { expect, test } from "bun:test"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as Single } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import { searchStateNode, searchStateParams } from "./searchStateTestUtils"

test("the experiment retains global rejection of physically blocked points", (): void => {
  const solver = new Single({ ...searchStateParams(), experimentSearchState: true })
  const parent = searchStateNode(0.4, 1.2)
  const blocked = searchStateNode(0.8, 1.2, parent)
  expect(solver.isNodeTooCloseToObstacle(blocked)).toBe(true)
  expect(solver.getNeighbors(parent).some((point) => solver.getNodeKey(point) === solver.getNodeKey(blocked))).toBe(false)
  expect(solver.exploredNodes.has(solver.getNodeKey(blocked))).toBe(true)
})
