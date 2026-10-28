import { expect, test } from "bun:test"
import { CertifiedDirectAutoroutingPipelineSolver } from "lib/testing/CertifiedDirectAutoroutingPipelineSolver"
import { extractBenchmarkStageTiming } from "../../../scripts/benchmark/benchmark-stage-timing"
import { getCertifiedDirectTestInput } from "tests/fixtures/certified-direct-input"

test("the original benchmark extractor sees real direct eligibility and solve times and unchanged general stages", async () => {
  const constructorStart = performance.now()
  const direct = new CertifiedDirectAutoroutingPipelineSolver(getCertifiedDirectTestInput(), { cacheProvider: null, effort: 1 })
  const constructorEnd = performance.now()
  expect(direct.selectedStrategy).toBe("certified-direct")
  const partial = extractBenchmarkStageTiming(direct, "partial")
  expect(partial.stages.map((stage) => stage.stageName)).toEqual(["certifiedDirectEligibility"])
  expect(partial.stages[0].elapsedTimeMs).toBeGreaterThan(0)
  const solveStart = performance.now()
  await direct.solveAsync()
  const solveEnd = performance.now()
  const completed = extractBenchmarkStageTiming(direct, "complete")
  expect(direct.solved).toBe(true)
  expect(completed.stages.map((stage) => stage.stageName)).toEqual(["certifiedDirectEligibility", "certifiedDirectRouting"])
  let measuredWorkMs = 0
  for (const stage of completed.stages) {
    expect(Number.isFinite(stage.elapsedTimeMs)).toBe(true)
    expect(stage.elapsedTimeMs).toBeGreaterThanOrEqual(0)
    expect(stage.elapsedTimeMs).toBe(direct.endTimeOfPhase[stage.stageName] - direct.startTimeOfPhase[stage.stageName])
    measuredWorkMs += stage.elapsedTimeMs
  }
  expect(direct.startTimeOfPhase.certifiedDirectEligibility).toBeGreaterThanOrEqual(constructorStart)
  expect(direct.endTimeOfPhase.certifiedDirectEligibility).toBeLessThanOrEqual(constructorEnd)
  expect(direct.startTimeOfPhase.certifiedDirectRouting).toBeGreaterThanOrEqual(solveStart)
  expect(direct.endTimeOfPhase.certifiedDirectRouting).toBeLessThanOrEqual(solveEnd)
  expect(measuredWorkMs).toBeLessThanOrEqual(constructorEnd - constructorStart + solveEnd - solveStart)
  expect(direct.stats.pipeline9StagesExecuted).toBe(0)
  const input = getCertifiedDirectTestInput()
  input.obstacles = [{ type: "rect", center: { x: 0, y: 0 }, width: 0.2, height: 0.6,
    layers: ["top"], connectedTo: [] }]
  const general = new CertifiedDirectAutoroutingPipelineSolver(input, { cacheProvider: null, effort: 1 })
  expect(general.selectedStrategy).toBe("pipeline9")
  await general.solveAsync()
  expect(general.solved).toBe(true)
  expect(general.pipelineDef).toBe(general.pipeline9!.pipelineDef)
  expect(general.currentPipelineStepIndex).toBe(general.pipeline9!.currentPipelineStepIndex)
  expect(extractBenchmarkStageTiming(general, "complete")).toEqual(extractBenchmarkStageTiming(general.pipeline9!, "complete"))
})
