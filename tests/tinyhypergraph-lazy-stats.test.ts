import { expect, test } from "bun:test"
import input from "../fixtures/features/portpointpathing/tinyhypergraph-port-bridge-repro-input.json"
import { TinyHypergraphPortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"

type TinyPipelineTestHarness = {
  getCurrentStageName(): string
  getStageStats(): Record<string, unknown>
}

type TinyHypergraphParams = ConstructorParameters<
  typeof TinyHypergraphPortPointPathingSolver
>[0]

test("TinyHypergraph stats stay current while unused snapshots are deferred", (): void => {
  const solver = new TinyHypergraphPortPointPathingSolver(
    structuredClone(input) as TinyHypergraphParams,
  )
  const pipeline = (
    solver as unknown as { tinyPipelineSolver: TinyPipelineTestHarness }
  ).tinyPipelineSolver
  const originalGetStageStats = pipeline.getStageStats
  let stageStatsCalls = 0
  pipeline.getStageStats = (): Record<string, unknown> => {
    stageStatsCalls++
    return originalGetStageStats.call(pipeline)
  }
  expect(solver.stats).toEqual({})

  while (!solver.solved && !solver.failed) {
    const callsBeforeStep = stageStatsCalls
    solver.step()
    expect(stageStatsCalls).toBe(callsBeforeStep)
    const stats = solver.stats
    expect(stageStatsCalls).toBe(callsBeforeStep + 1)
    expect(stats.currentStage).toBe(pipeline.getCurrentStageName())
    expect(stats.stageStats).toEqual(originalGetStageStats.call(pipeline))
    expect(solver.stats).toBe(stats)
    expect(stageStatsCalls).toBe(callsBeforeStep + 1)
  }

  expect(solver.solved).toBe(true)
  expect(solver.stats.candidatePortfolioPhase).toBe("complete")
  const output = solver.getOutput()
  expect(solver.stats.changedPreloadedTraceSectionCount).toBe(
    output.changedPreloadedTraceSections.length,
  )
})
