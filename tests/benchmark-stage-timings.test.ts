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
      timeSpentOnPhase: { preprocessSolver: 17 },
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

  const waitingToStart = extractBenchmarkStageTiming(
    {
      currentPipelineStepIndex: 1,
      pipelineDef: [
        { solverName: "preprocessSolver" },
        { solverName: "routeSolver" },
        { solverName: "postprocessSolver" },
      ],
      startTimeOfPhase: { preprocessSolver: 10 },
      timeSpentOnPhase: { preprocessSolver: 17 },
    },
    "partial",
    75,
  )
  expect(waitingToStart).toEqual({
    status: "partial",
    stages: [{ stageName: "preprocessSolver", elapsedTimeMs: 17 }],
  })

  expect(() =>
    extractBenchmarkStageTiming(
      {
        currentPipelineStepIndex: 1,
        pipelineDef: [{ solverName: "routeSolver" }],
        startTimeOfPhase: { routeSolver: 10 },
        timeSpentOnPhase: {},
      },
      "complete",
      75,
    ),
  ).toThrow("Completed benchmark stage routeSolver is missing elapsed time")
})
