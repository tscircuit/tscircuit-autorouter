import { expect, test } from "bun:test"
import {
  createSolverForTask,
  runTask,
} from "../scripts/benchmark/benchmark-run-task"
import {
  getPipeline9PostRoutingBenchmarkOptions,
  PIPELINE9_POST_ROUTING_BENCHMARK_ARM,
} from "../scripts/benchmark/pipeline9-post-routing-profile"
import { boardFixture } from "./post-routing/fixtures"

test("the checked-in P9 benchmark profile actually enables its declared arm within one total budget", () => {
  const input = boardFixture().srj,
    original = structuredClone(input)
  const options = getPipeline9PostRoutingBenchmarkOptions(input)
  const stages = [
    options.dynamicNetTreeRouting,
    options.postRoutingOptimization,
  ].filter(Boolean)
  expect(stages.reduce((n, s) => n + s!.search.maxMilliseconds, 0)).toBe(5000)
  expect(stages.reduce((n, s) => n + s!.search.maxExpansions, 0)).toBe(300000)
  expect(Boolean(options.dynamicNetTreeRouting)).toBe(
    PIPELINE9_POST_ROUTING_BENCHMARK_ARM.includes("A"),
  )
  expect(Boolean(options.postRoutingOptimization)).toBe(
    PIPELINE9_POST_ROUTING_BENCHMARK_ARM.includes("B"),
  )
  const solver = createSolverForTask({
    datasetName: "generic",
    scenarioName: "two-nets",
    sampleNumber: 1,
    solverName: "AutoroutingPipelineSolver9_PreloadedTraceGraph",
    scenario: input,
  })
  expect(
    solver.pipelineDef.some((s) => s.solverName === "dynamicNetTreeSolver"),
  ).toBe(PIPELINE9_POST_ROUTING_BENCHMARK_ARM.includes("A"))
  expect(
    solver.pipelineDef.some((s) => s.solverName === "postRoutingForestSolver"),
  ).toBe(PIPELINE9_POST_ROUTING_BENCHMARK_ARM.includes("B"))
  expect(input).toEqual(original)
})

test("a routed unsupported benchmark remains explicitly ineligible and has no via score", async () => {
  const scenario = boardFixture().srj
  scenario.obstacles[0]!.layers = ["top", "bottom"]
  const result = await runTask({
    datasetName: "generic",
    scenarioName: "missing-plating",
    sampleNumber: 1,
    solverName: "AutoroutingPipelineSolver9_PreloadedTraceGraph",
    scenario,
  })
  expect(result.didSolve).toBe(false)
  expect(result.viaCount).toBeUndefined()
  expect(result.postRoutingBenchmark?.pipelineSolved).toBe(true)
  expect(result.postRoutingBenchmark?.eligible).toBe(false)
  expect(result.error).toContain("ineligible")
  for (const report of result.postRoutingBenchmark!.reports) {
    expect(report.beforeSha256 ?? "").toMatch(/^[a-f0-9]{64}$/)
    expect(report.afterSha256).toBe(report.beforeSha256)
    expect(report.actualOptions.enabled).toBe(true)
    expect(report.actualOptions.search?.maxMilliseconds).toBe(
      PIPELINE9_POST_ROUTING_BENCHMARK_ARM === "A+B" ? 2500 : 5000,
    )
  }
})
