import { expect, test } from "bun:test"
import type { BenchmarkReport } from "../scripts/benchmark/benchmark-types"
import {
  isNetworkedColdHotReport,
  renderBenchmarkComparison,
} from "../scripts/benchmark/benchmark-comment-comparison.js"

test("networked benchmark comments compare the cold and hot passes", () => {
  const report: BenchmarkReport = {
    version: 1,
    datasetName: "srj18",
    scenarioCount: 1,
    effortLabel: "1x effort",
    summary: [
      {
        solverName: "Pipeline9_Networked Cold",
        completedRateLabel: "100.0%",
        relaxedDrcRateLabel: "100.0%",
        timedOutLabel: "0/1",
        p50TimeMs: 4_000,
        p95TimeMs: 4_000,
        avgVia: 2,
        networkCache: {
          remoteRequests: 3,
          cacheHits: 0,
          solverResults: 3,
          batchCacheMisses: 3,
          localFallbacks: 0,
        },
      },
      {
        solverName: "Pipeline9_Networked Hot",
        completedRateLabel: "100.0%",
        relaxedDrcRateLabel: "100.0%",
        timedOutLabel: "0/1",
        p50TimeMs: 1_000,
        p95TimeMs: 1_000,
        avgVia: 2,
        networkCache: {
          remoteRequests: 3,
          cacheHits: 3,
          solverResults: 0,
          batchCacheMisses: 0,
          localFallbacks: 0,
        },
      },
    ],
    solverFailureSummary: [],
    timeoutSummary: [],
    failureSummary: [],
    snapshots: [],
    tests: [
      {
        solverName: "Pipeline9_Networked Cold",
        scenarioName: "sample001",
        sampleNumber: 1,
        elapsedTimeMs: 4_000,
        didSolve: true,
        didTimeout: false,
        relaxedDrcPassed: true,
        viaCount: 2,
        drcErrorCount: 0,
      },
      {
        solverName: "Pipeline9_Networked Hot",
        scenarioName: "sample001",
        sampleNumber: 1,
        elapsedTimeMs: 1_000,
        didSolve: true,
        didTimeout: false,
        relaxedDrcPassed: true,
        viaCount: 2,
        drcErrorCount: 0,
      },
    ],
  }

  expect(isNetworkedColdHotReport(report)).toBe(true)
  expect(
    renderBenchmarkComparison({ mainReport: null, prReport: report }).join(
      "\n",
    ),
  ).toContain(`| P95 time | 4.0s | 1.0s | -75.0% |
| Average vias | 2.00 | 2.00 | 0.0% |
| HD cache hits | 0/3 | 3/3 | +3 |
| HD solver results | 3 | 0 | -3 |
| HD local fallbacks | 0 | 0 | 0 |`)
  expect(
    renderBenchmarkComparison({ mainReport: null, prReport: report }).join(
      "\n",
    ),
  ).toContain("an unmeasured Workers KV propagation interval")
})
