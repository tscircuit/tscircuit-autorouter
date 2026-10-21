import type { BenchmarkReport } from "../../scripts/benchmark/benchmark-types"

export function createThreadComparisonReport(
  elapsedTimeMs: number,
  threads: number,
): BenchmarkReport {
  const solverName = "AutoroutingPipelineSolver9_PreloadedTraceGraph"
  return {
    version: 1,
    datasetName: "srj18",
    scenarioCount: 1,
    effortLabel: "1x effort",
    summary: [
      {
        solverName,
        completedRateLabel: "100.0%",
        relaxedDrcRateLabel: "100.0%",
        timedOutLabel: "0/1",
        p50TimeMs: elapsedTimeMs,
        p95TimeMs: elapsedTimeMs,
        p50PeakRssBytes: elapsedTimeMs * 1024 * 1024,
        p90PeakRssBytes: elapsedTimeMs * 1024 * 1024,
        avgVia: elapsedTimeMs / 100,
      },
    ],
    solverFailureSummary: [],
    timeoutSummary: [],
    failureSummary: [],
    snapshots: [],
    tests: [
      {
        solverName,
        scenarioName: "sample001",
        sampleNumber: 1,
        elapsedTimeMs,
        sampleTimeoutMs: 10_000,
        didSolve: true,
        didTimeout: false,
        relaxedDrcPassed: true,
        drcErrorCount: 0,
        stageTiming: {
          status: "complete",
          stages: [{ stageName: "highDensity", elapsedTimeMs }],
        },
      },
    ],
    runtime: {
      bunVersion: "test",
      platform: "linux",
      architecture: "arm64",
      cpuModel: "test",
      logicalCpuCount: 8,
      availableParallelism: 8,
      memoryLimitBytes: 8 * 1024 ** 3,
      memoryBudgetPerWorkerBytes: 6 * 1024 ** 3,
      threadsPerSample: threads,
      effectiveThreadsPerSample: threads,
      requestedConcurrency: 1,
      workerCount: 1,
    },
  }
}
