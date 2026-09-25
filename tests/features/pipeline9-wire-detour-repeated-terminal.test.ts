import { expect, test } from "bun:test"
import { applyPipeline9IndependentWireDetours } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/applyPipeline9IndependentWireDetours"
import { createWireDetourFixture } from "../fixtures/pipeline9-wire-detour-fixture"

test("duplicate terminal anchors do not hide a single wire from detour repair", (): void => {
  const fixture = createWireDetourFixture()
  const wire = fixture.routes[0]!
  wire.route[0]!.pcb_port_id = "signal_0_start"
  wire.route.at(-1)!.pcb_port_id = "signal_0_end"
  wire.route.splice(1, 0, { ...wire.route[0]!, pcb_port_id: undefined })
  wire.route.splice(-1, 0, { ...wire.route.at(-1)!, pcb_port_id: undefined })
  const original = structuredClone(fixture.routes)
  const before = fixture.drcEvaluator({ traces: [], routes: fixture.routes })
  const errors = Array.isArray(before) ? before : before.errors
  expect(errors).toHaveLength(2)
  const result = applyPipeline9IndependentWireDetours({
    ...fixture,
    maxCandidateAttempts: 4,
    maxPathSearchNodes: 30000,
  })
  const after = fixture.drcEvaluator({ traces: [], routes: result.routes })
  expect(Array.isArray(after) ? after : after.errors).toEqual(
    errors.filter((error) => error.type !== "pcb_via_trace_clearance_error"),
  )
  expect(result.routes[0]!.route.length).toBeGreaterThan(2)
  expect(result.routes[0]!.route[0]).toEqual(original[0]!.route[0])
  expect(result.routes[0]!.route.at(-1)).toEqual(original[0]!.route.at(-1))
  expect(result.routes.slice(1)).toEqual(original.slice(1))
  expect(result.candidateAttempts).toBeGreaterThan(0)
  expect(result.candidateAttempts).toBeLessThanOrEqual(4)
  expect(result.pathSearchNodes).toBeLessThanOrEqual(30000)
  expect(fixture.routes).toEqual(original)
})
