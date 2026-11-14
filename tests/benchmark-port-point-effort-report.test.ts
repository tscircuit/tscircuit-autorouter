import { expect, test } from "bun:test"
import { getRoutingBenchmarkMetrics } from "../scripts/benchmark/benchmark-run-task"
import { renderBenchmarkComparison } from "../scripts/benchmark/benchmark-comment-comparison.js"
import { renderSameMachineBenchmarkResults } from "../scripts/benchmark/same-machine-results"
import { createThreadComparisonReport } from "./fixtures/threadComparisonReport"

test("benchmark comments distinguish the requested effort from each revision's port-point budget", (): void => {
  const measuredMetrics = (
    params: { effort: number; iterationBudgetEffort?: number },
    limit: number,
  ): ReturnType<typeof getRoutingBenchmarkMetrics> => {
    return getRoutingBenchmarkMetrics({
      currentPipelineStepIndex: 0,
      pipelineDef: [],
      startTimeOfPhase: {},
      timeSpentOnPhase: {},
      portPointPathingSolver: {
        getConstructorParams: () => [params],
        MAX_ITERATIONS: limit,
        getSolveGraphBenchmarkMetrics: () => undefined,
      },
    })
  }

  const baseReport = createThreadComparisonReport(1000, 1)
  const prReport = createThreadComparisonReport(1000, 1)
  for (const report of [baseReport, prReport]) {
    report.effortLabel = "2x effort"
    report.tests[0]!.requestedEffort = 2
  }
  baseReport.tests[0]!.routingMetrics = measuredMetrics({ effort: 1 }, 400)
  prReport.tests[0]!.routingMetrics = measuredMetrics(
    { effort: 1, iterationBudgetEffort: 2 },
    800,
  )
  const sameMachine = renderSameMachineBenchmarkResults({
    baseReport,
    prReport,
    baseSha: "abc",
    prSha: "def",
    repository: "owner/router",
    runnerName: "fixture",
  })
  const regular = renderBenchmarkComparison({
    mainReport: baseReport,
    prReport,
  }).join("\n")
  for (const markdown of [regular, sameMachine]) {
    expect(markdown).toContain("| Pipeline9 | Requested effort | 2× | 2× |")
    expect(markdown).toContain(
      "| Pipeline9 | Port-point budget effort | 1× | 2× |",
    )
    expect(markdown).toContain(
      "| Pipeline9 | Port-point iteration limit | 400 | 800 |",
    )
  }

  const baseThreaded = createThreadComparisonReport(1000, 4)
  const prThreaded = createThreadComparisonReport(1000, 4)
  for (const report of [baseThreaded, prThreaded]) {
    report.effortLabel = "2x effort"
    report.tests[0]!.requestedEffort = 2
  }
  baseThreaded.tests[0]!.routingMetrics = measuredMetrics({ effort: 1 }, 450)
  prThreaded.tests[0]!.routingMetrics = measuredMetrics(
    { effort: 1, iterationBudgetEffort: 2 },
    850,
  )
  expect(
    renderSameMachineBenchmarkResults({
      baseReport,
      prReport,
      baseSha: "abc",
      prSha: "def",
      repository: "owner/router",
      runnerName: "fixture",
      threaded: { threads: 4, baseReport: baseThreaded, prReport: prThreaded },
    }),
  ).toContain(
    "| Pipeline9 | Port-point iteration limit | 400 | 800 | 450 | 850 |",
  )

  const oldMain = createThreadComparisonReport(1000, 1)
  prReport.tests.push({
    ...prReport.tests[0]!,
    sampleNumber: 2,
    requestedEffort: 1.5,
    routingMetrics: undefined,
    didTimeout: true,
    didSolve: false,
  })
  const partial = renderBenchmarkComparison({
    mainReport: oldMain,
    prReport,
  }).join("\n")
  expect(partial).toContain("| Pipeline9 | Requested effort | 1× | 1.5×–2× |")
  expect(partial).toContain(
    "| Pipeline9 | Port-point iteration limit | n/a | 800 (1/2 samples) |",
  )
  expect(
    renderBenchmarkComparison({ mainReport: null, prReport }).join("\n"),
  ).toContain("| Pipeline9 | Requested effort | n/a | 1.5×–2× |")
})
