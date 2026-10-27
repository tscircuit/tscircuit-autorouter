import { expect, test } from "bun:test"
import { JointComponentEscapePlannerSolver } from "lib/solvers/JointComponentEscapePlannerSolver/JointComponentEscapePlannerSolver"
import { createJointComponentEscapeFixture } from "tests/fixtures/createJointComponentEscapeFixture"

test("a registered net key does not capture a distinct unregistered literal connection", () => {
  const input = createJointComponentEscapeFixture()
  input.connections[1]!.name = "net0"
  for (const node of input.nodesWithPortPoints) {
    for (const point of node.portPoints) {
      if (point.connectionName === "B") {
        point.connectionName = "net0"
        point.rootConnectionName = "A"
      }
    }
  }
  input.connectivityNetMap = { net0: ["A"] }
  input.obstacles.push({ type: "rect", obstacleId: "registered-pad", center: { x: 0, y: 1.25 }, width: 0.1, height: 0.1, layers: ["top"], connectedTo: ["A"] })
  const solver = new JointComponentEscapePlannerSolver(input)
  solver.solve()
  expect(solver.stats.predictedCrossingsBefore).toBe(2)
  expect(solver.stats.predictedCrossingsAfter).toBe(0)
  expect(solver.stats.reorderedPortalCount).toBe(4)
  expect(solver.stats.slotNeighborTests).toBeGreaterThan(0)
  const blocked = structuredClone(input)
  blocked.obstacles[0]!.center.y = 1
  const gated = new JointComponentEscapePlannerSolver(blocked)
  gated.solve()
  expect(gated.stats.predictedCrossingsBefore).toBe(2)
  expect(gated.stats.predictedCrossingsAfter).toBe(2)
  expect(gated.stats.reorderedPortalCount).toBe(0)
  expect(gated.stats.rejectedSlotOrders).toBeGreaterThan(0)
})
