import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { TinyHypergraphPortPointPathingSolver } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("an active upstream refinement retains discarded detailed work and cumulative native effort without a live HD reference", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 1)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(scenario), { effort: 1, cacheProvider: null })
  while (!solver.solved && !solver.failed && !(solver.detailedRoutingFeedback.stats.detailedFeedbackReplanCount > 0 && solver.activeSubSolver instanceof TinyHypergraphPortPointPathingSolver)) solver.step()
  expect(solver.failed, solver.error ?? "").toBe(false)
  expect(solver.highDensityRouteSolver).toBeUndefined()
  const pathing = solver.portPointPathingSolver!
  const priorDetailed = solver.detailedRoutingRounds.reduce((sum, round) => sum + round.detailedIterations, 0)
  const priorPathing = solver.detailedRoutingRounds.reduce((sum, round) => sum + round.pathingIterations, 0)
  expect(priorDetailed).toBeGreaterThan(0)
  expect(pathing.stats.detailedFeedbackReplanCount).toBe(1)
  expect(pathing.stats.detailedFeedbackTotalDetailedIterations).toBe(priorDetailed)
  expect(pathing.stats.detailedFeedbackTotalPathingIterations).toBe(priorPathing + pathing.iterations)
  for (let index = 0; index < 4; index++) solver.step()
  expect(pathing.stats.detailedFeedbackTotalDetailedIterations).toBe(priorDetailed)
  expect(pathing.stats.detailedFeedbackTotalPathingIterations).toBe(priorPathing + pathing.iterations)
  expect(pathing.stats.detailedFeedbackTotalOrdinaryNodeAttemptCount).toBeGreaterThan(0)
})
