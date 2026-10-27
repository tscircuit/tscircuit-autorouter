import { expect, test } from "bun:test"
import { JointComponentEscapePlannerSolver } from "lib/solvers/JointComponentEscapePlannerSolver/JointComponentEscapePlannerSolver"
import { createJointComponentEscapeFixture } from "tests/fixtures/createJointComponentEscapeFixture"

test("same-net pad permission belongs to the assigned net rather than to a shared slot", () => {
  const input = createJointComponentEscapeFixture()
  input.connectivityNetMap = { netA: ["A", "pad-alias-A"], netB: ["B"] }
  input.obstacles.push({ type: "rect", obstacleId: "pad-A", center: { x: 0, y: 1 }, width: 0.2, height: 0.2, layers: ["top"], connectedTo: ["pad-alias-A"] })
  const solver = new JointComponentEscapePlannerSolver(input)
  solver.solve()
  expect(solver.stats.predictedCrossingsAfter).toBe(2)
  expect(solver.stats.reorderedPortalCount).toBe(0)
  expect(solver.stats.rejectedSlotOrders).toBeGreaterThan(0)
  expect(solver.blockedPortalSamples.some((sample) => sample.obstacleId === "pad-A")).toBe(true)
})
