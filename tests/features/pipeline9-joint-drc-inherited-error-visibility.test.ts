import { expect, test } from "bun:test"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { createPipeline9InheritedPadClearanceFixture } from "../fixtures/create-pipeline9-inherited-pad-clearance-fixture"

test("Pipeline9 keeps an inherited pad pair visible when its clearance worsens", (): void => {
  const { srj, originalSrj, trace, solver } =
    createPipeline9InheritedPadClearanceFixture()
  const evaluate = solver.exactRepairSolver?.params.drcEvaluator
  expect(evaluate).toBeDefined()
  if (!evaluate) throw new Error("Expected inherited copper DRC evaluator")
  const initialRoutes = solver.movablePreloadedSections.map(
    (section) => structuredClone(section.hdRoute),
  )
  const worsenedRoutes = structuredClone(initialRoutes)
  for (const point of worsenedRoutes[0]!.route.slice(1, -1)) {
    point.y = -0.32
  }
  const initial = evaluate({ traces: [], routes: initialRoutes })
  const worsened = evaluate({ traces: [], routes: worsenedRoutes })
  if (Array.isArray(initial) || Array.isArray(worsened)) {
    throw new Error("Expected indexed DRC errors with centers")
  }
  expect(initial.errors).toHaveLength(1)
  expect(worsened.errors).toHaveLength(1)
  expect(worsened.errors[0]).toMatchObject({
    type: "pcb_pad_trace_clearance_error",
    pcb_trace_id: initial.errors[0]?.pcb_trace_id,
    pcb_pad_id: "pad_foreign",
  })
  expect(Number(worsened.errors[0]?.actual_clearance)).toBeLessThan(
    Number(initial.errors[0]?.actual_clearance),
  )

  // Independently verify that this is the same official pair, not a mock
  // finding or a new identifier that happens to escape baseline filtering.
  const worsenedTrace = structuredClone(trace)
  worsenedTrace.__replaces_pcb_trace_id = trace.pcb_trace_id
  for (const point of worsenedTrace.route.slice(1, -1)) {
    if (point.route_type === "wire") point.y = -0.32
  }
  const baseline = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: srj,
    routedTraces: [],
  })
  const officialWorsened = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: srj,
    routedTraces: [worsenedTrace],
  })
  expect(baseline.errors).toHaveLength(1)
  expect(officialWorsened.errors).toHaveLength(1)
  const initialError = baseline.errors[0]!
  const worsenedError = officialWorsened.errors[0]!
  if (
    initialError.type !== "pcb_pad_trace_clearance_error" ||
    worsenedError.type !== "pcb_pad_trace_clearance_error"
  ) {
    throw new Error("Expected genuine pad-to-trace clearance findings")
  }
  expect(worsenedError.pcb_pad_trace_clearance_error_id).toBe(
    initialError.pcb_pad_trace_clearance_error_id,
  )
  expect(Number(worsenedError.actual_clearance)).toBeLessThan(
    Number(initialError.actual_clearance),
  )
  expect(srj).toEqual(originalSrj)
})
