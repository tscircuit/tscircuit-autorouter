import { expect, test } from "bun:test"
import { JointComponentEscapePlannerSolver } from "lib/solvers/JointComponentEscapePlannerSolver/JointComponentEscapePlannerSolver"
import { createJointComponentEscapeFixture } from "tests/fixtures/createJointComponentEscapeFixture"

test("unaffected wide contacts on the area side constrain the component exit order", () => {
  const input = createJointComponentEscapeFixture()
  input.nodesWithPortPoints[1]!.portPoints.push({ connectionName: "wide", portPointId: "wide-terminal", pcb_port_id: "wide-terminal", x: 0.1, y: 1, z: 0 })
  input.connections.push({ name: "wide", nominalTraceWidth: 1, pointsToConnect: [{ x: 0.1, y: 1, layer: "top" }, { x: 3, y: 1, layer: "top" }] })
  const solver = new JointComponentEscapePlannerSolver(input)
  solver.solve()
  expect(solver.stats.rejectedContactAssignments).toBeGreaterThan(0)
  expect(solver.stats.reorderedPortalCount).toBe(0)
  expect(solver.blockedPortalSamples.some((sample) => sample.reason === "neighbor-spacing")).toBe(true)
})
