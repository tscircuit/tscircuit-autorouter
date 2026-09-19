import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { loadScenarioBySampleNumber } from "../scripts/benchmark/scenarios"

test("lazy stats stay fresh and rerouting scores the emitted path after loop removal", async () => {
  const { scenario } = await loadScenarioBySampleNumber("dataset01", 58)
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
    structuredClone(scenario),
    { cacheProvider: null },
  )
  while (!solver.portPointPathingSolver && !solver.failed) solver.step()
  const pathing = solver.portPointPathingSolver!
  solver.step()
  const searchingStats = pathing.stats
  expect(searchingStats.candidatePortfolioPhase).toBe("primary")
  expect(pathing.stats).toBe(searchingStats)
  while (!pathing.solved && !solver.failed) solver.step()
  expect(pathing.solved).toBe(true)
  const finalStats = pathing.stats
  expect(finalStats).not.toBe(searchingStats)
  expect(finalStats.candidatePortfolioPhase).toBe("complete")
  // Circuit143 has a searched loop that serialization removes. Counting that
  // loop in the early check wrongly rejects an improvement and later rewrites.
  expect(finalStats.acceptedReroutes).toBe(7)
  expect(finalStats.initialEstimatedViaCount).toBe(352)
  expect(finalStats.finalEstimatedViaCount).toBe(312)
  expect(finalStats.finalSegmentCount).toBe(468)
  expect(finalStats.finalMaxRegionCost).toBeCloseTo(0.46618705035971203, 12)
  expect(pathing.stats).toBe(finalStats)
})
