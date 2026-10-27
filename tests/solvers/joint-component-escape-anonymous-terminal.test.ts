import { expect, test } from "bun:test"
import { JointComponentEscapePlannerSolver } from "lib/solvers/JointComponentEscapePlannerSolver/JointComponentEscapePlannerSolver"
import { createJointComponentEscapeFixture } from "tests/fixtures/createJointComponentEscapeFixture"

test("a physical terminal remains fixed even when its assigned port omits pcb_port_id", () => {
  const input = createJointComponentEscapeFixture()
  input.connections[0]!.pointsToConnect[0] = { x: 0, y: 1, layer: "top" }
  const solver = new JointComponentEscapePlannerSolver(input)
  solver.solve()
  expect(solver.stats.protectedPhysicalTerminalCount).toBeGreaterThan(0)
  for (const node of solver.getOutput()) {
    for (const point of node.portPoints.filter((p) => p.portPointId === "left-A")) {
      expect(point.x).toBe(0)
      expect(point.y).toBe(1)
      expect(point.z).toBe(0)
    }
  }
})
