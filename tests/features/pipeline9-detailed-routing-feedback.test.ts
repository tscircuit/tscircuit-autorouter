import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "../../lib/testing/evaluate-relaxed-drc"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("Pipeline9 learns real detailed-node failures and changes upstream assignments before producing a clean board", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 1)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { cacheProvider: null, effort: 1 },
  )
  solver.solve()
  expect(solver.solved, solver.error ?? "").toBe(true)
  expect(solver.failed).toBe(false)
  const feedback = solver.detailedRoutingFeedback
  expect(feedback.stats.detailedFeedbackLearnedConflictCount).toBeGreaterThan(0)
  expect(feedback.stats.detailedFeedbackReplanCount).toBeGreaterThan(0)
  expect(feedback.stats.detailedFeedbackEarlyReplanCount).toBeGreaterThan(0)
  expect(Number.isFinite(feedback.stats.detailedFeedbackPausedAttemptCount)).toBe(true)
  expect(feedback.stats.detailedFeedbackReplanCount).toBeLessThanOrEqual(2)
  expect(feedback.stats.detailedFeedbackChangedNodeAssignmentCount).toBeGreaterThan(0)
  expect(feedback.stats.detailedFeedbackHardExclusionCount).toBe(0)
  expect(solver.detailedRoutingRounds.length).toBeGreaterThan(1)
  expect(solver.highDensityRouteSolver!.stats.detailedFeedbackAvoidedRegionalRecoveryCount).toBeGreaterThan(0)
  expect(solver.detailedRoutingRounds.filter((round) => round.status === "refined")
    .every((round) => round.regionalRecoveryCount === 0)).toBe(true)
  expect(solver.portPointPathingSolver!.stats.detailedConflictPenaltyApplications).toBeGreaterThan(0)
  for (const conflict of feedback.conflicts) {
    expect(conflict.node.portPoints.length).toBeGreaterThan(0)
    expect(conflict.geometryContext).toContain("obstacles")
    expect(conflict.geometryContext).toContain("netMap")
    expect(conflict.error.length).toBeGreaterThan(0)
  }
  const drc = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs!,
    routedTraces: solver.getOutputSimplifiedPcbTraces(),
  })
  expect(drc.errors).toEqual([])
})
