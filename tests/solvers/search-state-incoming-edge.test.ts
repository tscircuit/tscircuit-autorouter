import { expect, test } from "bun:test"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as Single } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import { searchStateNode, searchStateParams } from "./searchStateTestUtils"

test("a blocked incoming segment preserves a legal arrival at the same cell", (): void => {
  for (const enabled of [false, true]) {
    const diagnostics: Record<string, number> = {}
    const solver = new Single({
      ...searchStateParams(), experimentSearchState: enabled,
      searchStateDiagnostics: diagnostics,
    })
    const badParent = searchStateNode(0.8, 0.8)
    const goodParent = searchStateNode(1.2, 0.8)
    const target = searchStateNode(1.2, 1.2, badParent)
    const key = solver.getNodeKey(target)
    expect(solver.cellStep).toBe(0.4)
    expect(solver.isNodeTooCloseToObstacle(badParent)).toBe(false)
    expect(solver.isNodeTooCloseToObstacle(goodParent)).toBe(false)
    expect(solver.isNodeTooCloseToObstacle(target)).toBe(false)
    expect(solver.doesPathToParentIntersectObstacle(target)).toBe(true)
    expect(solver.doesPathToParentIntersectObstacle({ ...target, parent: goodParent })).toBe(false)
    const rejectedNeighbors = solver.getNeighbors(badParent)
    expect(rejectedNeighbors.some((neighbor) => solver.getNodeKey(neighbor) === key)).toBe(false)
    expect(solver.exploredNodes.has(key)).toBe(!enabled)
    const alternateNeighbors = solver.getNeighbors(goodParent)
    expect(alternateNeighbors.some((neighbor) => solver.getNodeKey(neighbor) === key)).toBe(enabled)
    if (enabled) {
      expect(diagnostics.searchStateLowLevelInstances).toBe(1)
      expect(diagnostics.searchStateDirectedEdgeRejections).toBeGreaterThan(0)
    } else {
      expect(diagnostics).toEqual({})
    }
    expect(solver.MAX_ITERATIONS).toBe(10_000)
  }
})
