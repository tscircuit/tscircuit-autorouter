import { expect, test } from "bun:test"
import { Pipeline9FinalCopperRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9FinalCopperRepairSolver"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { createFinalCopperRepairFixture } from "tests/fixtures/pipeline9-final-copper-fixture"

test("final copper repair clears a real pad collision without changing dimensions", (): void => {
  const { srj, trace } = createFinalCopperRepairFixture()
  const input = JSON.stringify({ srj, trace })
  const before = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: srj,
    routedTraces: [],
  })
  expect(before.errors.length).toBeGreaterThan(0)
  const solver = new Pipeline9FinalCopperRepairSolver({
    originalSrj: srj,
    srjWithPointPairs: srj,
    traces: [trace],
    effort: 1,
  })
  solver.solve()
  expect(solver.failed).toBeFalse()
  const output = solver.getOutput()
  expect(solver.getRoutedTraces()[0]!.__replaces_pcb_trace_id).toBe(
    trace.pcb_trace_id,
  )
  const after = evaluateRelaxedDrc({
    inputSrj: srj,
    srjWithPointPairs: srj,
    routedTraces: output,
  })
  expect(after.errors).toHaveLength(0)
  expect(output[0]!.route[0]).toEqual(trace.route[0])
  expect(output[0]!.route.at(-1)).toEqual(trace.route.at(-1))
  expect(
    output[0]!.route.map((point) =>
      point.route_type === "wire" ? point.width : undefined,
    ),
  ).toEqual(Array(6).fill(0.15))
  expect(JSON.stringify({ srj, trace })).toBe(input)
})
