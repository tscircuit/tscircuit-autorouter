import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "lib/testing/getBugReportSnapshotSvg"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"
import "../fixtures/svg-matcher"

test("SRJ18 sample 16 repairs new copper from six reference DRC errors to four", async () => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 16)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { cacheProvider: null, effort: 1 },
  )
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.failed).toBeFalse()
  const input = {
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  }
  const { errors } = evaluateRelaxedDrc(input)
  // Parent 664966b produces six errors on this same board and checker.
  // Regional repair removes the inner2 via short and the pad_168 clearance.
  expect(errors).toHaveLength(4)
  expect(errors.some((error) => error.message.includes("pcb_via"))).toBeFalse()
  expect(
    errors.some((error) => error.message.includes("pcb_port_168")),
  ).toBeFalse()
  expect(solver.pipeline9JointDrcRepairSolver!.stats).toMatchObject({
    regionalB01RepairPreloadEligibleDrcIssueCount: 0,
    regionalB01RepairAttempted: true,
  })
  expect(
    Number(
      solver.pipeline9JointDrcRepairSolver!.stats
        .regionalB01RepairAcceptedCount,
    ),
  ).toBeGreaterThan(0)
  await expect(getBugReportSnapshotSvg(input)).toMatchSvgSnapshot(
    import.meta.path,
  )
})
