import { expect, test } from "bun:test"
import type {
  BenchmarkReport,
  SolverRunSummary,
} from "../scripts/benchmark/benchmark-types"
import { renderSameMachineBenchmarkResults } from "../scripts/benchmark/same-machine-results"

test("paired networked cold and hot comments expose each revision's cache counts", (): void => {
  const coldName = "Pipeline9_Networked Cold"
  const hotName = "Pipeline9_Networked Hot"
  const makeSummary = (
    solverName: string,
    networkCache?: SolverRunSummary["networkCache"],
  ): SolverRunSummary => ({
    solverName,
    completedRateLabel: "100.0%",
    relaxedDrcRateLabel: "100.0%",
    timedOutLabel: "0/1",
    p50TimeMs: 100,
    p95TimeMs: 100,
    avgVia: 1,
    networkCache,
  })
  const makeReport = (summary: SolverRunSummary[]): BenchmarkReport => ({
    version: 1,
    datasetName: "srj18",
    scenarioCount: 1,
    effortLabel: "1x effort",
    summary,
    solverFailureSummary: [],
    timeoutSummary: [],
    failureSummary: [],
    snapshots: [],
    tests: summary.map(({ solverName }) => ({
      solverName,
      scenarioName: "sample001",
      sampleNumber: 1,
      elapsedTimeMs: 100,
      sampleTimeoutMs: 1_000,
      didSolve: true,
      didTimeout: false,
      relaxedDrcPassed: true,
      drcErrorCount: 0,
    })),
  })
  const baseCold = {
    remoteRequests: 10,
    cacheHits: 0,
    solverResults: 10,
    batchCacheMisses: 10,
    localFallbacks: 0,
    validationRejections: 0,
  }
  const baseHot = {
    remoteRequests: 10,
    cacheHits: 10,
    solverResults: 0,
    batchCacheMisses: 0,
    localFallbacks: 0,
    validationRejections: 0,
  }
  const prCold = {
    remoteRequests: 12,
    cacheHits: 0,
    solverResults: 11,
    batchCacheMisses: 12,
    localFallbacks: 1,
    validationRejections: 1,
  }
  const prHot = {
    remoteRequests: 12,
    cacheHits: 11,
    solverResults: 0,
    batchCacheMisses: 0,
    localFallbacks: 1,
    validationRejections: 1,
  }
  const render = (
    baseReport: BenchmarkReport,
    prReport: BenchmarkReport,
  ): string =>
    renderSameMachineBenchmarkResults({
      baseReport,
      prReport,
      baseSha: "a".repeat(40),
      prSha: "b".repeat(40),
      repository: "tscircuit/tscircuit-autorouter",
      runnerName: "blacksmith-local-networked",
    })
  const baseReport = makeReport([
    makeSummary(coldName, baseCold),
    makeSummary(hotName, baseHot),
  ])
  const prReport = makeReport([
    makeSummary(coldName, prCold),
    makeSummary(hotName, prHot),
  ])
  const markdown = render(baseReport, prReport)

  expect(markdown).toContain(
    "| Pipeline9_Networked Cold | HD requests | 10 | 12 | +2 |",
  )
  expect(markdown).toContain(
    "| Pipeline9_Networked Cold | HD cache hits | 0/10 | 0/12 | 0 |",
  )
  expect(markdown).toContain(
    "| Pipeline9_Networked Cold | HD solver results | 10 | 11 | +1 |",
  )
  expect(markdown).toContain(
    "| Pipeline9_Networked Cold | HD local fallbacks | 0 | 1 | +1 |",
  )
  expect(markdown).toContain(
    "| Pipeline9_Networked Hot | HD requests | 10 | 12 | +2 |",
  )
  expect(markdown).toContain(
    "| Pipeline9_Networked Hot | HD cache hits | 10/10 | 11/12 | +1 |",
  )
  expect(markdown).toContain(
    "| Pipeline9_Networked Hot | HD solver results | 0 | 0 | 0 |",
  )
  expect(markdown).toContain(
    "| Pipeline9_Networked Hot | HD local fallbacks | 0 | 1 | +1 |",
  )
  expect(markdown).toContain(
    "| Pipeline9_Networked Cold | HD validation retries | 0 | 1 | +1 |",
  )
  expect(markdown).toContain(
    "| Pipeline9_Networked Hot | HD validation retries | 0 | 1 | +1 |",
  )

  const historicalBase = makeReport([
    makeSummary(coldName),
    makeSummary(hotName),
  ])
  expect(render(historicalBase, prReport)).toContain(
    "| Pipeline9_Networked Hot | HD cache hits | n/a | 11/12 | n/a |",
  )
  const otherName = "AutoroutingPipelineSolver7_MultiGraph"
  expect(
    render(
      makeReport([makeSummary(otherName, baseCold)]),
      makeReport([makeSummary(otherName, prCold)]),
    ),
  ).toBe(
    render(
      makeReport([makeSummary(otherName)]),
      makeReport([makeSummary(otherName)]),
    ),
  )
})
