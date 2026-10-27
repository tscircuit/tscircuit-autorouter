import { expect, test } from "bun:test"
import { JointComponentEscapePlannerSolver } from "lib/solvers/JointComponentEscapePlannerSolver/JointComponentEscapePlannerSolver"
import { createJointComponentEscapeFixture } from "tests/fixtures/createJointComponentEscapeFixture"

test("disabling joint escape planning gives a same-revision control with unchanged port geometry", () => {
  const input = createJointComponentEscapeFixture()
  input.enabled = false
  const solver = new JointComponentEscapePlannerSolver(input)
  solver.solve()
  expect(solver.getOutput()).toEqual(input.nodesWithPortPoints)
  expect(solver.stats.candidateAssignmentsEvaluated).toBe(0)
  expect(solver.stats.predictedCrossingsAfter).toBe(2)
})
