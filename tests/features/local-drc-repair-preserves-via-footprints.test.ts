import { expect, test } from "bun:test"
import { LocalDrcRepairSolver } from "lib/solvers/LocalDrcRepairSolver/LocalDrcRepairSolver"
import { createLocalDrcRepairFixture } from "../fixtures/local-drc-repair-fixture"

test("shared-via cleanup cannot move a larger coincident drill into a smaller existing footprint", (): void => {
  const input = createLocalDrcRepairFixture()
  const large = structuredClone(input.traces[1]!)
  large.pcb_trace_id = "larger_shared_via"
  for (const point of large.route) {
    if (point.route_type === "via") {
      point.via_diameter = 0.5
      point.via_hole_diameter = 0.25
    }
  }
  input.traces.push(large)
  const before = structuredClone(large)
  const solver = new LocalDrcRepairSolver(input)
  solver.solve()
  expect(solver.failed, solver.error ?? "").toBeFalse()
  expect(solver.stats.mergedViaGroups).toBe(1)
  expect(solver.getOutput().at(-1)).toEqual(before)
  expect(solver.getOutput()[0]!.route.find((p) => p.route_type === "via")?.x).toBe(0.02)
})
