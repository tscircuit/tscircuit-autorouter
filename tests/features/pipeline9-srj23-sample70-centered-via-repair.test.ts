import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 resolves SRJ23 sample 70 before regional B01 repair", async () => {
  const { scenario } = await loadScenarioBySampleNumber("srj23", 70)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { cacheProvider: null, effort: 1 },
  )

  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  // Trace simplification now lets exact repair clear this board before B01.
  // Exact via-center coverage remains in drc-via-trace-center.test.ts.
  expect(solver.pipeline9JointDrcRepairSolver?.stats).toMatchObject({
    postExactReferenceDrcIssueCount: 0,
    postExactReferenceAccepted: true,
    regionalB01RepairAttempted: false,
    regionalB01RepairAcceptedCount: 0,
  })
  const { errors } = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })
  expect(errors).toHaveLength(0)
})
