import { expect, test } from "bun:test"
import { extractBenchmarkStageTiming } from "../scripts/benchmark/benchmark-stage-timing"

test("benchmark stage timing extraction preserves pipeline order and live timing", () => {
  const completed = extractBenchmarkStageTiming(
    {
      currentPipelineStepIndex: 3,
      pipelineDef: [
        { solverName: "preprocessSolver" },
        { solverName: "routeSolver" },
        { solverName: "postprocessSolver" },
      ],
      startTimeOfPhase: {
        preprocessSolver: 10,
        routeSolver: 30,
        postprocessSolver: 80,
      },
      endTimeOfPhase: {
        preprocessSolver: 25,
        routeSolver: 70,
        postprocessSolver: 95,
      },
      timeSpentOnPhase: {
        preprocessSolver: 14,
        routeSolver: 39,
        postprocessSolver: 12,
      },
    },
    "complete",
    100,
  )
  expect(completed).toEqual({
    status: "complete",
    stages: [
      { stageName: "preprocessSolver", elapsedTimeMs: 14 },
      { stageName: "routeSolver", elapsedTimeMs: 39 },
      { stageName: "postprocessSolver", elapsedTimeMs: 12 },
    ],
  })

  const partial = extractBenchmarkStageTiming(
    {
      currentPipelineStepIndex: 1,
      pipelineDef: [
        { solverName: "preprocessSolver" },
        { solverName: "routeSolver" },
        { solverName: "postprocessSolver" },
      ],
      startTimeOfPhase: { preprocessSolver: 10, routeSolver: 40 },
      endTimeOfPhase: { preprocessSolver: 30 },
      timeSpentOnPhase: { preprocessSolver: 17, routeSolver: 0 },
    },
    "partial",
    75,
  )
  expect(partial).toEqual({
    status: "partial",
    stages: [
      { stageName: "preprocessSolver", elapsedTimeMs: 17 },
      { stageName: "routeSolver", elapsedTimeMs: 35 },
    ],
  })
  expect(
    extractBenchmarkStageTiming(
      {
        currentPipelineStepIndex: 0,
        pipelineDef: [{ solverName: "routeSolver" }],
      },
      "partial",
      75,
    ),
  ).toBeUndefined()
  expect(() =>
    extractBenchmarkStageTiming(
      {
        currentPipelineStepIndex: 1,
        pipelineDef: [{ solverName: "routeSolver" }],
        startTimeOfPhase: { routeSolver: 10 },
        endTimeOfPhase: { routeSolver: 20 },
        timeSpentOnPhase: { routeSolver: -1 },
      },
      "complete",
      75,
    ),
  ).toThrow("Invalid elapsed time for benchmark stage routeSolver")
})
