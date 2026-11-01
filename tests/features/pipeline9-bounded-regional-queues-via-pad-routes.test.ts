import { expect, test } from "bun:test"
import { NegotiateTraceClearanceSolver } from "@tscircuit/repair04"
import { Pipeline9BoundedRegionalRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9BoundedRegionalRepairSolver"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("a selected region queues its via-pad routes alongside trace crossings", (): void => {
  const fixture = createBoundedRegionalRepairFixture(2)
  fixture.routes[0]!.route.splice(1, 1)
  // Keep the terminal via fixed so projection cannot erase this route's error
  // before the mixed region reaches negotiation.
  const viaRoute = fixture.routes[1]!
  viaRoute.route = [
    { x: 0, y: 2, z: 0, pcb_port_id: "start_1" },
    { x: 0, y: 2, z: 1 },
    { x: 4, y: 2, z: 1 },
  ]
  viaRoute.vias = [{ x: 0, y: 2 }]
  for (const point of fixture.originalSrj.connections[1]!.pointsToConnect) {
    point.y = 2
  }
  fixture.originalSrj.connections[1]!.pointsToConnect[0]!.x = 0
  fixture.originalSrj.connections[1]!.pointsToConnect[1]!.layer = "bottom"
  for (const obstacle of fixture.originalSrj.obstacles.slice(3)) {
    obstacle.center.y = 2
  }
  fixture.originalSrj.obstacles[3]!.center.x = 0
  fixture.originalSrj.obstacles[4]!.layers = ["bottom"]
  const foreignPad = fixture.originalSrj.obstacles[5]!
  foreignPad.center.x = 0.26
  foreignPad.width = 0.2
  foreignPad.height = 0.2
  const original = structuredClone(fixture.routes)
  const before = fixture.drcEvaluator({ routes: fixture.routes, traces: [] })
  const initialErrors = Array.isArray(before) ? before : before.errors
  expect(initialErrors.map((error) => error.type).sort()).toEqual([
    "pcb_pad_pad_clearance_error",
    "pcb_trace_error",
  ])
  const solver = new Pipeline9BoundedRegionalRepairSolver({
    ...fixture,
    budget: {
      maxRegions: 1,
      maxCandidateAttempts: 256,
      maxPathSearchNodes: 480_000,
      regionSizes: [10],
    },
  })
  while (
    !solver.solved &&
    !solver.failed &&
    !(solver.activeSubSolver instanceof NegotiateTraceClearanceSolver)
  ) {
    solver.step()
  }
  const negotiation = solver.activeSubSolver
  expect(negotiation).toBeInstanceOf(NegotiateTraceClearanceSolver)
  if (!(negotiation instanceof NegotiateTraceClearanceSolver)) {
    throw new Error("Mixed clearance errors must reach regional negotiation")
  }
  expect(
    negotiation.input.dirtyRouteIndices.map(
      (index) => negotiation.input.routes[index]!.connectionName,
    ),
  ).toEqual(["signal_0", "signal_1"])
  solver.solve()
  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
  const result = solver.getResult()
  expect(result.attemptedRegionCount).toBe(1)
  expect(result.publishedDrcIssueCount).toBe(1)
  const after = fixture.drcEvaluator({ routes: result.routes, traces: [] })
  expect(Array.isArray(after) ? after : after.errors).toEqual(
    initialErrors.filter(
      (error) => error.type === "pcb_pad_pad_clearance_error",
    ),
  )
  expect(result.routes[0]).not.toEqual(original[0])
  expect(result.routes[1]).toEqual(original[1])
  expect(fixture.routes).toEqual(original)
})
