import { expect, test } from "bun:test"
import type { AnyCircuitElement } from "circuit-json"
import { filterPipeline9OriginalOwnerCopperFeedbackErrors, getPipeline9OriginalOwnerCopperFeedback } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9OriginalOwnerCopperFeedback"
import { makeOriginalOwnerCopperFeedbackFixture } from "./fixtures/originalOwnerCopperFeedback"

test("stable physical baseline contacts survive canonical reordering, prepared trace aliases and via ordinal changes without hiding moved copper", (): void => {
  const fixture = makeOriginalOwnerCopperFeedbackFixture()
  const evaluated = fixture.evaluate(fixture.params.newHdRoutes)
  const get = (traces: typeof evaluated.traces, circuitJson: AnyCircuitElement[], aliases = new Map<string, string>()): ReturnType<typeof getPipeline9OriginalOwnerCopperFeedback> =>
    getPipeline9OriginalOwnerCopperFeedback({ originalSrj: fixture.params.originalSrj,
      srjWithPointPairs: fixture.params.srjWithPointPairs, routedTraces: traces, circuitJson,
      originalTraceIdByPreparedTraceId: aliases })
  const baseline = get(evaluated.traces, evaluated.native.circuitJson)
  expect(baseline.errors).toHaveLength(1)
  const prepared = evaluated.traces.map((trace) => ({ ...structuredClone(trace), pcb_trace_id: `${trace.pcb_trace_id}__prepared` }))
  const aliases = new Map(prepared.map((trace, i) => [trace.pcb_trace_id, evaluated.traces[i]!.pcb_trace_id]))
  const circuit = structuredClone(evaluated.native.circuitJson).reverse().map((element) => {
    if (element.type === "pcb_trace") return { ...element, pcb_trace_id: `${element.pcb_trace_id}__prepared` }
    if (element.type === "pcb_via") return { ...element, pcb_trace_id: `${element.pcb_trace_id}__prepared`, pcb_via_id: `opaque_${element.pcb_via_id}_changed` }
    return element
  })
  const same = get(prepared, circuit, aliases)
  expect(same.status).toBe("SUPPORTED")
  expect(same.errors[0]!.originalOwnerCopperFeedbackKey).toBe(baseline.errors[0]!.originalOwnerCopperFeedbackKey)
  expect(filterPipeline9OriginalOwnerCopperFeedbackErrors({ errors: same.errors, baselineErrors: baseline.errors })).toEqual([])
  const moved = structuredClone(fixture.params.newHdRoutes)
  moved[0]!.route[1]!.y = 0.02; moved[0]!.route[2]!.y = 0.02; moved[0]!.vias[0]!.y = 0.02
  const movedEvaluation = fixture.evaluate(moved)
  const worse = get(movedEvaluation.traces, movedEvaluation.native.circuitJson)
  expect(Number(worse.errors[0]!.actual_clearance)).toBeLessThan(Number(baseline.errors[0]!.actual_clearance))
  expect(filterPipeline9OriginalOwnerCopperFeedbackErrors({ errors: worse.errors, baselineErrors: baseline.errors })).toEqual(worse.errors)
  expect(evaluated.native.circuitJson.some((element) => element.type === "pcb_via" && element.pcb_via_id.startsWith("opaque_"))).toBe(false)
})
