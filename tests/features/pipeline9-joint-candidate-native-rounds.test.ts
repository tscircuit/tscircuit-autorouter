import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"

test("default Pipeline9 allocates native complete-round candidates above the density portfolio's 99-route limit", async (): Promise<void> => {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 1)
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(scenario)
  pipeline.solveUntilPhase("portPointPathingSolver")
  while (
    pipeline.getCurrentPhase() === "portPointPathingSolver" &&
    !pipeline.failed && !pipeline.solved
  ) {
    pipeline.step()
  }

  const pathing = pipeline.portPointPathingSolver!
  expect(pipeline.failed).toBe(false)
  expect(pathing.solved).toBe(true)
  const metrics = pathing.getSolveGraphBenchmarkMetrics()!
  expect(metrics.routeCount).toBeGreaterThan(99)
  expect(metrics.traceDensityCandidateEvaluated).toBe(false)
  expect(pathing.stats.jointCandidateEnabled).toBe(1)
  expect(pathing.stats.jointCandidateCompleteRounds).toBeGreaterThan(1)
  expect(pathing.stats.jointCandidateDistinctCaptures).toBeGreaterThan(1)
  expect(pathing.stats.jointCandidateRetainedCandidates).toBe(2)
  expect(pathing.stats.jointCandidateFinalizationCount).toBe(1)
  expect(pathing.stats.jointCandidateAvailableBoards).toBe(1)
  expect(pathing.stats.jointCandidateEligibleBoards).toBe(1)
  expect(pathing.stats.jointCandidateTrials).toBeGreaterThan(0)
  expect(pathing.getOutput().nodesWithPortPoints.length).toBeGreaterThan(0)

  const [params] = pathing.getConstructorParams()
  const baseline = new TinyHypergraphPortPointPathingSolver({
    ...params,
    flags: { ...params.flags, USE_JOINT_ROUTE_CANDIDATE_ALLOCATION: false },
  })
  baseline.solve()
  const baselineMetrics = baseline.getSolveGraphBenchmarkMetrics()!
  expect(baseline.solved).toBe(true)
  expect(pathing.MAX_ITERATIONS).toBe(baseline.MAX_ITERATIONS)
  expect(metrics.iterations).toBe(baselineMetrics.iterations)
  expect(metrics.ripCount).toBe(baselineMetrics.ripCount)
  expect(metrics.outsideInForwardExpansionCount).toBe(baselineMetrics.outsideInForwardExpansionCount)
  expect(metrics.outsideInReverseExpansionCount).toBe(baselineMetrics.outsideInReverseExpansionCount)
})
