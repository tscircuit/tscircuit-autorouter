import { expect, test } from "bun:test"
import { runTask } from "../scripts/benchmark/benchmark-run-task"
import scenario from "./fixtures/trace-linting.srj.json"

test("benchmark workers record style issues from completed Pipeline9 output", async () => {
  const result = await runTask({
    datasetName: "unit-test", solverName: "AutoroutingPipelineSolver9_PreloadedTraceGraph",
    scenarioName: "preloaded-trace", sampleNumber: 1, scenario,
  })
  expect(result.error).toBeUndefined()
  expect(result.didSolve).toBe(true)
  expect(result.traceLintIssueCounts).toEqual({ odd_angle: 1 })
})
