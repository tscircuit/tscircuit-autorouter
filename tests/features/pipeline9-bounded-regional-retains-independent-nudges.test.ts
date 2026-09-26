import { expect, test } from "bun:test"
import { applyPipeline9BoundedRegionalRepairs } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9BoundedRegionalRepairs"
import { createBoundedRegionalRepairFixture } from "../fixtures/pipeline9-bounded-regional-repair-fixture"

test("bounded repair retains a pad nudge while an unrelated crossing remains", (): void => {
  const fixture = createBoundedRegionalRepairFixture(2)
  fixture.routes[0]!.route = [
    { x: -4, y: 0, z: 0, pcb_port_id: "start_0" },
    { x: -1, y: 0.28, z: 0, traceThickness: 0.1 },
    { x: 1, y: 0.28, z: 0, traceThickness: 0.1 },
    { x: 4, y: 0, z: 0, pcb_port_id: "end_0" },
  ]
  // This straight, terminal-to-terminal crossing needs a topology change.
  fixture.routes[1]!.route.splice(1, 1)
  const original = structuredClone(fixture.routes)
  const before = fixture.drcEvaluator({ traces: [], routes: fixture.routes })
  const beforeErrors = Array.isArray(before) ? before : before.errors
  expect(
    beforeErrors.some(
      (error) => error.type === "pcb_pad_trace_clearance_error",
    ),
  ).toBe(true)
  expect(beforeErrors.some((error) => error.type === "pcb_trace_error")).toBe(
    true,
  )
  const result = applyPipeline9BoundedRegionalRepairs({
    ...fixture,
    budget: { maxRegions: 1, maxCandidateAttempts: 1, maxPathSearchNodes: 1 },
  })
  const after = fixture.drcEvaluator({ traces: [], routes: result.routes })
  const afterErrors = Array.isArray(after) ? after : after.errors
  expect(afterErrors.length).toBeLessThan(beforeErrors.length)
  expect(afterErrors.some((error) => error.type === "pcb_trace_error")).toBe(
    true,
  )
  expect(
    afterErrors.some((error) => error.type === "pcb_pad_trace_clearance_error"),
  ).toBe(false)
  expect(result.publishedDrcIssueCount).toBe(afterErrors.length)
  expect(result.repaired).toBe(false)
  expect(fixture.routes).toEqual(original)
  expect(result.routes[0]!.route[0]).toEqual(original[0]!.route[0])
  expect(result.routes[0]!.route.at(-1)).toEqual(original[0]!.route.at(-1))
  expect(result.routes[0]!.route.map((point) => point.traceThickness)).toEqual(
    original[0]!.route.map((point) => point.traceThickness),
  )
})
