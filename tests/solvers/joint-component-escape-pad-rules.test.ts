import { expect, test } from "bun:test"
import { JointComponentEscapePlannerSolver } from "lib/solvers/JointComponentEscapePlannerSolver/JointComponentEscapePlannerSolver"
import { createJointComponentEscapeFixture } from "tests/fixtures/createJointComponentEscapeFixture"

test("explicit pad clearance controls which component-exit orders are legal", () => {
  for (const gap of [0.05, 0.3]) {
    const input = createJointComponentEscapeFixture()
    input.obstacleMargin = 5
    input.padClearance = gap
    input.obstacles.push({ type: "rect", obstacleId: "foreign-pad", center: { x: 0, y: 1.25 }, width: 0.1, height: 0.1, layers: ["top"], connectedTo: ["foreign"] })
    const solver = new JointComponentEscapePlannerSolver(input)
    solver.solve()
    expect(solver.stats.predictedCrossingsAfter).toBe(gap === 0.05 ? 0 : 2)
    expect(solver.stats.reorderedPortalCount).toBe(gap === 0.05 ? 4 : 0)
  }
})
