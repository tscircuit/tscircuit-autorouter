import { expect, test } from "bun:test"
import { JointComponentEscapePlannerSolver } from "lib/solvers/JointComponentEscapePlannerSolver/JointComponentEscapePlannerSolver"
import { createJointComponentEscapeFixture } from "tests/fixtures/createJointComponentEscapeFixture"

test("one package coordinates its escape order with routing to ordinary external terminals", () => {
  const input = createJointComponentEscapeFixture()
  input.componentAreas.pop()
  input.capacityNodes[2]!._isComponentTopologyNode = false
  for (const node of input.nodesWithPortPoints) {
    for (const point of node.portPoints) {
      if (point.portPointId === "right-A") point.y = -1
      if (point.portPointId === "right-B") point.y = 1
    }
  }
  const solver = new JointComponentEscapePlannerSolver(input)
  solver.solve()
  expect(solver.stats.sourcePackageExternalBundleCount).toBe(1)
  expect(solver.stats.predictedCrossingsBefore).toBe(2)
  expect(solver.stats.predictedCrossingsAfter).toBe(0)
  expect(solver.stats.reorderedPortalCount).toBe(2)
  expect(solver.stats.jointlyReorderedFamilyPairs).toBe(0)
})
