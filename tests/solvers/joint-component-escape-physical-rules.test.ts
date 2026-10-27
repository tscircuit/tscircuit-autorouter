import { expect, test } from "bun:test"
import { JointComponentEscapePlannerSolver } from "lib/solvers/JointComponentEscapePlannerSolver/JointComponentEscapePlannerSolver"
import { createJointComponentEscapeFixture } from "tests/fixtures/createJointComponentEscapeFixture"

test("explicit copper gaps control escape compatibility independently of search margin", () => {
  for (const clearance of [0.05, 0.3]) {
    const input = createJointComponentEscapeFixture()
    const seen = new Set<object>()
    for (const node of input.nodesWithPortPoints) {
      for (const point of node.portPoints) {
        if (!seen.has(point)) point.y *= 0.2
        seen.add(point)
      }
    }
    for (const connection of input.connections) {
      for (const point of connection.pointsToConnect) point.y *= 0.2
    }
    input.obstacleMargin = 5
    input.traceClearance = clearance
    input.padClearance = clearance
    const solver = new JointComponentEscapePlannerSolver(input)
    solver.solve()
    expect(solver.stats.predictedCrossingsBefore).toBe(2)
    expect(solver.stats.predictedCrossingsAfter).toBe(clearance === 0.05 ? 0 : 2)
    expect(solver.stats.reorderedPortalCount).toBe(clearance === 0.05 ? 4 : 0)
  }
})
