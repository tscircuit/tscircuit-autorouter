import { expect, test } from "bun:test"
import { LoopedReassignmentZeroViaSolver } from "../../../lib/solvers/LoopedReassignmentZeroViaSolver/LoopedReassignmentZeroViaSolver"
import { simpleRouteJson } from "../../../examples/unassigned-obstacles/LoopedReassignmentZeroViaSolver/LoopedReassignmentZeroViaSolver01.fixture"

test("LoopedReassignmentZeroViaSolver should solve with obstacle assignment", async () => {
  // Create solver with the test SRJ
  const solver = new LoopedReassignmentZeroViaSolver(simpleRouteJson, {})

  // Run the solver until completion or failure
  solver.solve()

  // Verify solver completed successfully
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)

  // Get output traces
  const outputTraces = solver.getOutputSimplifiedPcbTraces()

  // Verify we have traces
  expect(outputTraces).toBeDefined()
  expect(outputTraces.length).toBeGreaterThan(0)

  // Check that there are no vias in the output (the goal of this solver)
  const viaCount = outputTraces.flatMap((trace) =>
    trace.route.filter((segment) => segment.route_type === "via"),
  ).length
  expect(viaCount).toBe(0)

  // Verify the middle obstacle was assigned
  const outputSrj = solver.getOutputSimpleRouteJson()
  const middleObstacle = outputSrj.obstacles[1]
  expect(middleObstacle.netIsAssignable).toBeFalsy()
  expect(middleObstacle.connectedTo.length).toBeGreaterThan(0)

  // Verify connections were split
  expect(outputSrj.connections.length).toBeGreaterThan(1)
}, 20_000)
