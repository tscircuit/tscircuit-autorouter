import { expect, test } from "bun:test"
import { JointComponentEscapePlannerSolver } from "lib/solvers/JointComponentEscapePlannerSolver/JointComponentEscapePlannerSolver"
import { createJointComponentEscapeFixture } from "tests/fixtures/createJointComponentEscapeFixture"

test("a blocked exit domain prevents the joint permutation instead of moving ports through copper", () => {
  const input = createJointComponentEscapeFixture()
  input.obstacles.push({ type: "rect", center: { x: 0, y: 1 }, width: 0.2, height: 0.2, layers: ["top"], connectedTo: ["fixed-other-net"] })
  const solver = new JointComponentEscapePlannerSolver(input)
  solver.solve()
  expect(solver.stats.skippedBlockedPortalFamilyCount).toBe(1)
  expect(solver.stats.predictedCrossingsAfter).toBe(2)
  expect(solver.stats.reorderedPortalCount).toBe(0)
  expect(solver.getOutput()).toEqual(input.nodesWithPortPoints)
})
