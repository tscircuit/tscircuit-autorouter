import { expect, test } from "bun:test"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { createPipeline9InheritedPadClearanceFixture } from "../fixtures/create-pipeline9-inherited-pad-clearance-fixture"

test("Pipeline9 repairs an inherited ordinary trace without changing its pads or terminals", (): void => {
  const { srj, originalSrj, trace, solver } =
    createPipeline9InheritedPadClearanceFixture()
  const baseline = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: srj,
    routedTraces: [],
  })

  // The defect exists before routing; no mutation marker promotes this trace.
  expect(baseline.errors).toHaveLength(1)
  expect(baseline.errors[0]).toMatchObject({
    type: "pcb_pad_trace_clearance_error",
    pcb_trace_id: trace.pcb_trace_id,
    pcb_pad_id: "pad_foreign",
  })
  expect(solver.params.mutatedPreloadedTraceIds.size).toBe(0)
  expect(solver.stats.baselineJointDrcIssueCount).toBe(1)
  expect(solver.stats.initialJointDrcIssueCount).toBe(1)
  expect(solver.movablePreloadedSections).toHaveLength(1)

  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(solver.getOutput()).toEqual([])
  const repaired = solver.getMutatedPreloadedTraces()
  expect(repaired).toHaveLength(1)
  expect(repaired[0]?.__replaces_pcb_trace_id).toBe(trace.pcb_trace_id)
  expect(repaired[0]?.route).not.toEqual(trace.route)
  expect(repaired[0]?.route[0]).toEqual(trace.route[0])
  expect(repaired[0]?.route.at(-1)).toEqual(trace.route.at(-1))
  const finalDrc = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: srj,
    routedTraces: repaired,
  })
  expect(finalDrc.errors).toHaveLength(0)
  expect(srj).toEqual(originalSrj)
})
