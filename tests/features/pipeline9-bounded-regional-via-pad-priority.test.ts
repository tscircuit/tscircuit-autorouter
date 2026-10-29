import { expect, test } from "bun:test"
import { Pipeline9BoundedRegionalRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9BoundedRegionalRepairSolver"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("a fixed via-pad error does not move a repairable trace into the region collar", (): void => {
  const fixture = createBoundedRegionalRepairFixture()
  fixture.routes[0]!.route.splice(1, 1)
  fixture.originalSrj.bounds = {
    minX: -12,
    maxX: 12,
    minY: -6,
    maxY: 6,
  }
  fixture.originalSrj.connections.push({
    name: "via_signal",
    pointsToConnect: [
      {
        x: 8.8,
        y: 0,
        layer: "top",
        pointId: "via_start",
        pcb_port_id: "via_start",
      },
      {
        x: 8.8,
        y: 2,
        layer: "bottom",
        pointId: "via_end",
        pcb_port_id: "via_end",
      },
    ],
  })
  fixture.originalSrj.obstacles.push({
    type: "rect",
    center: { x: 9.06, y: 0 },
    width: 0.2,
    height: 0.2,
    layers: ["top"],
    connectedTo: ["foreign_via_pad"],
    circuitJsonMetadata: { pcb_smtpad_id: "foreign_via_pad" },
  })
  // This transition is fixed at a terminal. Combining its error center with
  // the trace crossing at x=0 puts that crossing in the crop's fixed collar.
  fixture.routes.push({
    connectionName: "via_signal",
    traceThickness: 0.1,
    viaDiameter: 0.3,
    route: [
      { x: 8.8, y: 0, z: 0, pcb_port_id: "via_start" },
      { x: 8.8, y: 0, z: 1 },
      { x: 8.8, y: 2, z: 1, pcb_port_id: "via_end" },
    ],
    vias: [{ x: 8.8, y: 0 }],
  })
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
  solver.solve()
  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
  const result = solver.getResult()
  const after = fixture.drcEvaluator({ routes: result.routes, traces: [] })
  const remainingErrors = Array.isArray(after) ? after : after.errors
  expect(remainingErrors).toEqual(
    initialErrors.filter(
      (error) => error.type === "pcb_pad_pad_clearance_error",
    ),
  )
  expect(result.publishedDrcIssueCount).toBe(1)
  expect(result.repaired).toBeFalse()
  expect(result.routes[0]).not.toEqual(original[0])
  expect(result.routes[1]).toEqual(original[1])
  expect(fixture.routes).toEqual(original)
})
