import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 repairs SRJ23 sample 44 before joint repair and preserves preloaded copper", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj23", 44)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { cacheProvider: null, effort: 1 },
  )

  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  expect(solver.repair04Solver?.stats.acceptedRegions).toBeGreaterThan(0)
  expect(solver.repair04Solver?.stats).toMatchObject({
    indexedErrors: 0,
    referenceErrors: 0,
    completionReason: "clean",
  })
  expect(solver.pipeline9JointDrcRepairSolver?.stats).toMatchObject({
    initialJointDrcIssueCount: 0,
    movablePreloadedTraceCount: 0,
    finalReferenceAcceptanceChecked: true,
    outputFinalReferenceDrcIssueCount: 0,
  })

  const routedTraces = solver.getOutputSimplifiedPcbTraces()
  const preloadedTraceIds = new Set(
    scenario.traces?.map((trace): string => trace.pcb_trace_id),
  )
  const replacements = routedTraces.filter((trace): boolean =>
    Boolean(trace.__replaces_pcb_trace_id),
  )
  expect(replacements.length).toBeGreaterThan(0)
  expect(
    new Set(
      replacements.map((trace): string => trace.__replaces_pcb_trace_id!),
    ).size,
  ).toBe(replacements.length)
  for (const trace of replacements) {
    expect(preloadedTraceIds.has(trace.__replaces_pcb_trace_id!)).toBeTrue()
  }

  const { errors } = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces,
  })
  expect(errors).toHaveLength(0)
})
