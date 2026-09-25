import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 reports SRJ18 sample 9's reference-clean output after regional repair", async () => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 9)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { cacheProvider: null, effort: 1 },
  )

  solver.solve()

  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  const repairStats = solver.pipeline9JointDrcRepairSolver?.stats
  // Earlier stages can retain issues; the final count must describe the
  // published, independently validated regional output.
  expect(Number(repairStats?.finalDrcIssueCount)).toBe(0)
  expect(repairStats).toMatchObject({
    postExactReferenceValidationAttempted: true,
    postExactReferenceAccepted: false,
    boundedRegionalRepairRepaired: true,
    boundedRegionalRepairPublishedDrcIssueCount: 0,
  })
  expect(Number(repairStats?.postExactReferenceDrcIssueCount)).toBeGreaterThan(0)
  expect(
    Number(repairStats?.boundedRegionalRepairAcceptedRegionCount),
  ).toBeGreaterThan(0)
  const { errors } = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })
  expect(errors).toHaveLength(0)
})
