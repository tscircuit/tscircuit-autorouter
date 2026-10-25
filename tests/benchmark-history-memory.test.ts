import { expect, test } from "bun:test"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  appendHistoryRun,
  readHistoryRuns,
  writeBenchmarkHistoryDashboard,
  type BenchmarkHistoryRun,
} from "../scripts/benchmark/benchmark-history"

test("benchmark history publishes peak RSS percentiles across all measured samples", async () => {
  const directory = await mkdtemp(join(tmpdir(), "benchmark-history-memory-"))
  const historyDirectory = join(directory, "history")
  const outputDirectory = join(directory, "dashboard")
  const mib = 1024 ** 2
  const expectedMemory = {
    p50PeakRssBytes: 640 * mib,
    p80PeakRssBytes: 1433.6 * mib,
    p90PeakRssBytes: 1740.8 * mib,
  }
  const run: BenchmarkHistoryRun = {
    version: 1,
    runId: "123-1",
    workflowRunId: "123",
    workflowRunAttempt: 1,
    runUrl:
      "https://github.com/tscircuit/tscircuit-autorouter/actions/runs/123",
    commitSha: "abc123",
    createdAt: "2026-10-25T12:00:00.000Z",
    runner: "test",
    metadata: {
      workflowRunId: "123",
      workflowRunAttempt: 1,
      commitSha: "abc123",
      createdAt: "2026-10-25T12:00:00.000Z",
      runner: { name: "test" },
    },
    report: {
      version: 1,
      datasetName: "srj18",
      scenarioCount: 5,
      effortLabel: "1x effort",
      summary: [
        {
          solverName: "Pipeline9",
          completedRateLabel: "60%",
          relaxedDrcRateLabel: "60%",
          timedOutLabel: "1/5",
          p50TimeMs: 20,
          p95TimeMs: 40,
          ...expectedMemory,
        },
      ],
      tests: [0, 256 * mib, 1024 * mib, undefined, 2048 * mib].map(
        (peakRssBytes, index) => ({
          solverName: "Pipeline9",
          scenarioName: `sample${index + 1}`,
          sampleNumber: index + 1,
          elapsedTimeMs: 10 * (index + 1),
          peakRssBytes,
          didSolve: index < 3,
          didTimeout: index === 4,
          relaxedDrcPassed: index < 3,
        }),
      ),
    },
  }
  if (run.report.version !== 1) throw new Error("Expected a single report")
  const report = run.report
  try {
    for (const invalid of [
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      "1024",
      null,
    ]) {
      const invalidRun = {
        ...run,
        report: {
          ...report,
          tests: [
            Object.assign({}, report.tests[0], { peakRssBytes: invalid }),
          ],
        },
      }
      await expect(
        appendHistoryRun({ historyDirectory, run: invalidRun }),
      ).rejects.toThrow("Invalid peakRssBytes")
    }
    await appendHistoryRun({ historyDirectory, run })
    const runs = await readHistoryRuns(historyDirectory)
    await writeBenchmarkHistoryDashboard({ runs, outputDirectory })
    const index = JSON.parse(
      await readFile(join(outputDirectory, "data/index.json"), "utf8"),
    )
    const point = index.points[0]
    expect(point.p50PeakRssBytes).toBe(expectedMemory.p50PeakRssBytes)
    expect(point.p80PeakRssBytes).toBeCloseTo(expectedMemory.p80PeakRssBytes)
    expect(point.p90PeakRssBytes).toBeCloseTo(expectedMemory.p90PeakRssBytes)
    expect(point.maxPeakRssBytes).toBe(2048 * mib)
    expect(point.samples).toBeUndefined()
    const archived = JSON.parse(
      await readFile(join(outputDirectory, "data/runs/123-1.json"), "utf8"),
    )
    expect(archived.report.tests[0].peakRssBytes).toBe(0)
    expect(archived.report.tests[4].peakRssBytes).toBe(2048 * mib)

    // Legacy artifacts have no memory fields; keep them absent rather than zero.
    const legacyReport = {
      ...report,
      summary: report.summary.map(
        ({ p50PeakRssBytes, p80PeakRssBytes, p90PeakRssBytes, ...summary }) =>
          summary,
      ),
      tests: report.tests.map(({ peakRssBytes, ...sample }) => sample),
    }
    await writeBenchmarkHistoryDashboard({
      runs: [{ ...run, report: legacyReport }],
      outputDirectory,
    })
    const legacyIndex = JSON.parse(
      await readFile(join(outputDirectory, "data/index.json"), "utf8"),
    )
    for (const key of [
      "p50PeakRssBytes",
      "p80PeakRssBytes",
      "p90PeakRssBytes",
      "maxPeakRssBytes",
    ]) {
      expect(legacyIndex.points[0][key]).toBeNull()
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
