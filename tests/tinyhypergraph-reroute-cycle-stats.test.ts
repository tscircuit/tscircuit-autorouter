import { expect, test } from "bun:test"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { loadScenarioBySampleNumber } from "../scripts/benchmark/scenarios"

test("lazy stats stay fresh after a conservative full-connection reroute", async () => {
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
  // The physical-routing policy accepts one improvement without increasing
  // any region cost; stats must reflect the accepted serialized output.
  expect(finalStats.acceptedReroutes).toBe(1)
  expect(finalStats.initialEstimatedViaCount).toBe(352)
  expect(finalStats.finalEstimatedViaCount).toBe(347)
  expect(finalStats.finalSegmentCount).toBe(470)
  expect(finalStats.finalMaxRegionCost).toBeCloseTo(0.5763767168083712, 12)
  expect(pathing.stats).toBe(finalStats)
})
