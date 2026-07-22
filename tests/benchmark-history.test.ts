import { expect, test } from "bun:test"
import { mkdtemp, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { BenchmarkReport } from "../scripts/benchmark/benchmark-types"
import {
  appendHistoryRun,
  createBenchmarkHistoryDashboard,
  getDashboardPoints,
  readHistoryRuns,
  type BenchmarkHistoryRun,
} from "../scripts/benchmark/benchmark-history"

const makeRun = (runId: string): BenchmarkHistoryRun => ({
  version: 1,
  runId,
  workflowRunId: runId,
  workflowRunAttempt: 1,
  runUrl: `https://example.com/runs/${runId}`,
  commitSha: "abc123",
  createdAt: `2026-01-0${runId}T00:00:00.000Z`,
  runner: "benchmark-runner",
  metadata: { repository: "example/autorouter" },
  report: {
    version: 1,
    datasetName: "dataset01",
    scenarioCount: 2,
    effortLabel: "1x effort",
    summary: [{ solverName: "Pipeline7", completedRateLabel: "50.0%", relaxedDrcRateLabel: "50.0%", timedOutLabel: "1/2", p50TimeMs: 100, p95TimeMs: 100, avgVia: 2 }],
    solverFailureSummary: [], timeoutSummary: [], failureSummary: [], snapshots: [],
    tests: [
      { solverName: "Pipeline7", scenarioName: "one", sampleNumber: 1, elapsedTimeMs: 100, didSolve: true, didTimeout: false, relaxedDrcPassed: true, viaCount: 2 },
      { solverName: "Pipeline7", scenarioName: "two", sampleNumber: 2, elapsedTimeMs: 500, didSolve: false, didTimeout: true, relaxedDrcPassed: false },
    ],
  } satisfies BenchmarkReport,
})

test("benchmark history retains full sample records and embeds a self-contained dashboard", async () => {
  const directory = await mkdtemp(join(tmpdir(), "benchmark-history-"))
  await appendHistoryRun({ historyDirectory: directory, run: makeRun("1") })
  const runs = await appendHistoryRun({ historyDirectory: directory, run: makeRun("2") })
  const retriedRuns = await appendHistoryRun({
    historyDirectory: directory,
    run: makeRun("2"),
  })
  const conflictingRun = { ...makeRun("2"), commitSha: "different" }
  const points = getDashboardPoints(runs)
  const firstReport = makeRun("1").report as BenchmarkReport
  const collectionPoints = getDashboardPoints([
    {
      ...makeRun("3"),
      report: {
        version: 2,
        kind: "benchmark-report-collection",
        generatedFor: "main",
        reports: [
          firstReport,
          { ...firstReport, datasetName: "dataset02" },
        ],
      },
    },
  ])
  const dashboard = createBenchmarkHistoryDashboard(runs)
  const fullDashboard = createBenchmarkHistoryDashboard(
    Array.from({ length: 101 }, (_, index) => ({
      ...makeRun(String(index + 1)),
      createdAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
    })),
  )
  const dashboardScript = dashboard.match(/<script>\n([\s\S]*)<\/script>/)?.[1]
  const cliDirectory = await mkdtemp(join(tmpdir(), "benchmark-history-cli-"))
  const reportPath = join(cliDirectory, "report.json")
  const metadataPath = join(cliDirectory, "metadata.json")
  await writeFile(reportPath, JSON.stringify(makeRun("1").report))
  await writeFile(
    metadataPath,
    JSON.stringify({
      workflowRunId: "987654321",
      workflowRunAttempt: 2,
      commitSha: "def456",
      createdAt: "2026-02-03T04:05:06.000Z",
      runner: { name: "metadata-runner" },
    }),
  )
  const recordProcess = Bun.spawnSync({
    cmd: [
      "bun",
      "scripts/benchmark/benchmark-history.ts",
      "record",
      "--report",
      reportPath,
      "--history-dir",
      join(cliDirectory, "history"),
      "--out",
      join(cliDirectory, "dashboard.html"),
      "--run-url",
      "https://example.com/runs/987654321",
      "--metadata",
      metadataPath,
    ],
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  })
  const recordedCliRun = (await readHistoryRuns(join(cliDirectory, "history")))[0]

  expect((await readHistoryRuns(directory))[0]?.report).toEqual(makeRun("1").report)
  expect(retriedRuns).toHaveLength(2)
  await expect(
    appendHistoryRun({ historyDirectory: directory, run: conflictingRun }),
  ).rejects.toThrow("conflicting workflow run 2")
  expect(points).toHaveLength(2)
  expect(points[0]?.p90TimeMs).toBe(100)
  expect(points[0]?.samples).toHaveLength(2)
  expect(collectionPoints.map((point) => point.datasetName)).toEqual([
    "dataset01",
    "dataset02",
  ])
  expect(dashboard).toContain("benchmark-history-data")
  expect(dashboard).toContain('"sampleNumber":1')
  expect(fullDashboard).toContain('"runId":"1"')
  expect(dashboardScript).toBeDefined()
  expect(() => new Function(dashboardScript!)).not.toThrow()
  expect(recordProcess.stderr.toString()).toBe("")
  expect(recordProcess.exitCode).toBe(0)
  expect(recordedCliRun?.runId).toBe("987654321-2")
  expect(recordedCliRun?.createdAt).toBe("2026-02-03T04:05:06.000Z")
  expect(recordedCliRun?.runner).toBe("metadata-runner")
})
