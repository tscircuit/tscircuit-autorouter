import { expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { BenchmarkReport } from "../scripts/benchmark/benchmark-types"
import {
  appendHistoryRun,
  createBenchmarkHistoryDashboardIndex,
  getDashboardPoints,
  writeBenchmarkHistoryDashboard,
  readHistoryRuns,
  type BenchmarkHistoryRun,
} from "../scripts/benchmark/benchmark-history"

const makeRun = (runId: string): BenchmarkHistoryRun => ({
  version: 1,
  runId: `${runId}-1`,
  workflowRunId: runId,
  workflowRunAttempt: 1,
  runUrl: `https://example.com/runs/${runId}`,
  commitSha: "abc123",
  createdAt: new Date(Date.UTC(2026, 0, Number(runId))).toISOString(),
  runner: "benchmark-runner",
  metadata: {
    repository: "example/autorouter",
    workflowRunId: runId,
    workflowRunAttempt: 1,
    commitSha: "abc123",
    createdAt: new Date(Date.UTC(2026, 0, Number(runId))).toISOString(),
    runner: { name: "benchmark-runner" },
  },
  report: {
    version: 1,
    datasetName: "dataset01",
    scenarioCount: 2,
    effortLabel: "1x effort",
    summary: [
      {
        solverName: "Pipeline7",
        completedRateLabel: "50.0%",
        relaxedDrcRateLabel: "50.0%",
        timedOutLabel: "1/2",
        p50TimeMs: 100,
        p95TimeMs: 100,
        avgVia: 2,
      },
    ],
    solverFailureSummary: [],
    timeoutSummary: [],
    failureSummary: [],
    snapshots: [],
    tests: [
      {
        solverName: "Pipeline7",
        scenarioName: "one",
        sampleNumber: 1,
        elapsedTimeMs: 100,
        didSolve: true,
        didTimeout: false,
        relaxedDrcPassed: true,
        viaCount: 2,
      },
      {
        solverName: "Pipeline7",
        scenarioName: "two",
        sampleNumber: 2,
        elapsedTimeMs: 500,
        didSolve: false,
        didTimeout: true,
        relaxedDrcPassed: false,
      },
    ],
  } satisfies BenchmarkReport,
})

test("benchmark history retains full sample records and publishes a static dashboard", async () => {
  const directory = await mkdtemp(join(tmpdir(), "benchmark-history-"))
  await appendHistoryRun({ historyDirectory: directory, run: makeRun("1") })
  const runs = await appendHistoryRun({
    historyDirectory: directory,
    run: makeRun("2"),
  })
  const retriedRuns = await appendHistoryRun({
    historyDirectory: directory,
    run: makeRun("2"),
  })
  const conflictingBaseRun = makeRun("2")
  const conflictingRun = {
    ...conflictingBaseRun,
    commitSha: "different",
    metadata: { ...conflictingBaseRun.metadata, commitSha: "different" },
  }
  const points = getDashboardPoints(runs)
  const firstReport = makeRun("1").report
  if (firstReport.version !== 1) throw new Error("Expected a single report")
  const collectionPoints = getDashboardPoints([
    {
      ...makeRun("3"),
      report: {
        version: 2,
        kind: "benchmark-report-collection",
        generatedFor: "main",
        reports: [firstReport, { ...firstReport, datasetName: "dataset02" }],
      },
    },
  ])
  const dashboardDirectory = await mkdtemp(
    join(tmpdir(), "benchmark-history-dashboard-"),
  )
  const fullDashboardDirectory = await mkdtemp(
    join(tmpdir(), "benchmark-history-full-dashboard-"),
  )
  await writeBenchmarkHistoryDashboard({
    outputDirectory: dashboardDirectory,
    runs,
  })
  await writeBenchmarkHistoryDashboard({
    outputDirectory: fullDashboardDirectory,
    runs: Array.from({ length: 101 }, (_, index) => makeRun(String(index + 1))),
  })
  const dashboard = await readFile(join(dashboardDirectory, "index.html"), "utf8")
  const dashboardScript = await readFile(
    join(dashboardDirectory, "index.js"),
    "utf8",
  )
  const dashboardData = JSON.parse(
    await readFile(join(dashboardDirectory, "data", "index.json"), "utf8"),
  )
  const fullDashboardData = createBenchmarkHistoryDashboardIndex(
    Array.from({ length: 101 }, (_, index) => makeRun(String(index + 1))),
  )
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
      "--out-dir",
      join(cliDirectory, "dashboard"),
      "--run-url",
      "https://example.com/runs/987654321",
      "--metadata",
      metadataPath,
    ],
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  })
  const recordedCliRun = (
    await readHistoryRuns(join(cliDirectory, "history"))
  )[0]
  const invalidMetadataPath = join(cliDirectory, "invalid-metadata.json")
  await writeFile(
    invalidMetadataPath,
    JSON.stringify({
      workflowRunId: "987654321",
      workflowRunAttempt: 2,
      commitSha: "def456",
      createdAt: "2026-02-03T04:05:06.000Z",
    }),
  )
  const invalidMetadataProcess = Bun.spawnSync({
    cmd: [
      "bun",
      "scripts/benchmark/benchmark-history.ts",
      "record",
      "--report",
      reportPath,
      "--history-dir",
      join(cliDirectory, "invalid-history"),
      "--out-dir",
      join(cliDirectory, "invalid-dashboard"),
      "--run-url",
      "https://example.com/runs/987654321",
      "--metadata",
      invalidMetadataPath,
    ],
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  })

  const malformedRateRun = makeRun("4")
  if (malformedRateRun.report.version !== 1) {
    throw new Error("Expected a single report")
  }
  const malformedSummary = malformedRateRun.report.summary[0]
  if (!malformedSummary) throw new Error("Expected a benchmark summary")
  malformedSummary.completedRateLabel = "not a rate"
  const missingSamplesRun = makeRun("5")
  if (missingSamplesRun.report.version !== 1) {
    throw new Error("Expected a single report")
  }
  missingSamplesRun.report.tests = []
  const legacyRun = makeRun("6")
  if (legacyRun.report.version !== 1)
    throw new Error("Expected a single report")
  const legacySummary = legacyRun.report.summary[0]
  if (!legacySummary) throw new Error("Expected a benchmark summary")
  delete legacySummary.avgVia
  legacyRun.report.tests.forEach((sample, index) => {
    sample.scenarioName = `circuit${String(index + 1).padStart(3, "0")}`
    delete sample.sampleNumber
  })
  const legacyPoint = getDashboardPoints([legacyRun])[0]

  const malformedAppendDirectory = await mkdtemp(
    join(tmpdir(), "benchmark-history-malformed-append-"),
  )
  await expect(
    appendHistoryRun({
      historyDirectory: malformedAppendDirectory,
      run: malformedRateRun,
    }),
  ).rejects.toThrow("Malformed dataset01 Pipeline7 completion rate label")

  const missingIndexDirectory = await mkdtemp(
    join(tmpdir(), "benchmark-history-missing-index-"),
  )
  await mkdir(join(missingIndexDirectory, "runs"))
  await writeFile(
    join(missingIndexDirectory, "runs", "10-1.json"),
    JSON.stringify(makeRun("10")),
  )

  const unindexedRunDirectory = await mkdtemp(
    join(tmpdir(), "benchmark-history-unindexed-run-"),
  )
  await appendHistoryRun({
    historyDirectory: unindexedRunDirectory,
    run: makeRun("11"),
  })
  await writeFile(join(unindexedRunDirectory, "runs", "unindexed.json"), "{}")

  const duplicateSampleRun = makeRun("12")
  if (duplicateSampleRun.report.version !== 1) {
    throw new Error("Expected a single report")
  }
  const duplicateSample = duplicateSampleRun.report.tests[1]
  if (!duplicateSample) throw new Error("Expected a second benchmark sample")
  duplicateSample.sampleNumber = 1

  const unknownSolverRun = makeRun("13")
  if (unknownSolverRun.report.version !== 1) {
    throw new Error("Expected a single report")
  }
  const unknownSolverSample = unknownSolverRun.report.tests[0]
  if (!unknownSolverSample) throw new Error("Expected a benchmark sample")
  unknownSolverSample.solverName = "UnknownSolver"

  const invalidSampleStateRun = makeRun("14")
  if (invalidSampleStateRun.report.version !== 1) {
    throw new Error("Expected a single report")
  }
  const invalidStateSample = invalidSampleStateRun.report.tests[0]
  if (!invalidStateSample) throw new Error("Expected a benchmark sample")
  invalidStateSample.didTimeout = true

  const invalidIndexDirectory = await mkdtemp(
    join(tmpdir(), "benchmark-history-invalid-index-"),
  )
  await writeFile(
    join(invalidIndexDirectory, "index.json"),
    JSON.stringify({
      version: 1,
      runs: [
        {
          runId: "7-1",
          createdAt: "2026-01-07T00:00:00.000Z",
          path: "../7-1.json",
        },
      ],
    }),
  )

  const mismatchedIndexDirectory = await mkdtemp(
    join(tmpdir(), "benchmark-history-mismatched-index-"),
  )
  await appendHistoryRun({
    historyDirectory: mismatchedIndexDirectory,
    run: makeRun("8"),
  })
  await writeFile(
    join(mismatchedIndexDirectory, "index.json"),
    JSON.stringify({
      version: 1,
      runs: [
        {
          runId: "8-1",
          createdAt: "2026-01-01T00:00:00.000Z",
          path: "runs/8-1.json",
        },
      ],
    }),
  )

  expect((await readHistoryRuns(directory))[0]?.report).toEqual(
    makeRun("1").report,
  )
  expect(retriedRuns).toHaveLength(2)
  await expect(
    appendHistoryRun({ historyDirectory: directory, run: conflictingRun }),
  ).rejects.toThrow("conflicting workflow run 2-1")
  await expect(
    appendHistoryRun({
      historyDirectory: directory,
      run: { ...makeRun("9"), runId: "../unsafe" },
    }),
  ).rejects.toThrow("Invalid benchmark history run fields")
  await expect(readHistoryRuns(invalidIndexDirectory)).rejects.toThrow(
    "Invalid path for benchmark history run 7-1",
  )
  await expect(readHistoryRuns(mismatchedIndexDirectory)).rejects.toThrow(
    "does not match",
  )
  await expect(readHistoryRuns(missingIndexDirectory)).rejects.toThrow(
    "Benchmark history index is missing",
  )
  await expect(readHistoryRuns(unindexedRunDirectory)).rejects.toThrow(
    "unindexed run file",
  )
  expect(() => getDashboardPoints([malformedRateRun])).toThrow(
    "Malformed dataset01 Pipeline7 completion rate label",
  )
  expect(() => getDashboardPoints([missingSamplesRun])).toThrow(
    "without samples",
  )
  expect(legacyPoint?.avgVia).toBeNull()
  expect(legacyPoint?.samples.map((sample) => sample.sampleNumber)).toEqual([
    1, 2,
  ])
  expect(() => getDashboardPoints([duplicateSampleRun])).toThrow(
    "duplicate sample 1",
  )
  expect(() => getDashboardPoints([unknownSolverRun])).toThrow(
    "without a summary",
  )
  await expect(
    appendHistoryRun({
      historyDirectory: malformedAppendDirectory,
      run: invalidSampleStateRun,
    }),
  ).rejects.toThrow("both solved and timed out")
  expect(existsSync(join(malformedAppendDirectory, "index.json"))).toBeFalse()
  expect(existsSync(join(malformedAppendDirectory, "runs"))).toBeFalse()
  expect(points).toHaveLength(2)
  expect(points[0]?.p90TimeMs).toBe(100)
  expect(points[0]?.samples).toHaveLength(2)
  expect(collectionPoints.map((point) => point.datasetName)).toEqual([
    "dataset01",
    "dataset02",
  ])
  expect(dashboard).toContain('href="./index.css"')
  expect(dashboard).toContain('src="./index.js"')
  expect(dashboard).not.toContain("benchmark-history-data")
  expect(dashboard).not.toContain('"sampleNumber":1')
  expect(dashboardData.points).toHaveLength(2)
  expect(dashboardData.points[0]).not.toHaveProperty("samples")
  expect(dashboardData.runs[0]).not.toHaveProperty("report")
  expect(dashboardData.runs[0]).not.toHaveProperty("metadata")
  expect(dashboardData.runs[0]?.path).toBe("runs/1-1.json")
  expect(JSON.parse(
    await readFile(join(dashboardDirectory, "data", "runs", "1-1.json"), "utf8"),
  ).report.tests).toHaveLength(2)
  expect(fullDashboardData.runs).toHaveLength(101)
  expect(fullDashboardData.points).toHaveLength(100)
  expect(fullDashboardData.points[0]?.runId).toBe("2-1")
  expect(dashboard).not.toContain("Largest regressions in view")
  expect(dashboard).toContain("Current health")
  expect(dashboard).toContain("Recent comparable runs")
  expect(dashboard).toContain("Copy summary")
  expect(dashboard).toContain("Export CSV")
  expect(dashboard).toContain("Solve time")
  expect(dashboard).toContain("Average vias")
  expect(dashboard).toContain('role="img"')
  expect(dashboardScript).toContain("data-metric")
  expect(dashboardScript).toContain("./data/index.json")
  expect(dashboardScript).toContain("loadRun")
  expect(dashboardScript).toContain("axis in")
  expect(() => new Function(dashboardScript)).not.toThrow()
  expect(recordProcess.stderr.toString()).toBe("")
  expect(recordProcess.exitCode).toBe(0)
  expect(invalidMetadataProcess.exitCode).toBe(1)
  expect(invalidMetadataProcess.stderr.toString()).toContain(
    "Invalid benchmark metadata fields",
  )
  expect(recordedCliRun?.runId).toBe("987654321-2")
  expect(existsSync(join(cliDirectory, "dashboard", "index.html"))).toBeTrue()
  expect(existsSync(join(cliDirectory, "dashboard", "data", "index.json"))).toBeTrue()
  expect(
    existsSync(join(cliDirectory, "dashboard", "data", "runs", "987654321-2.json")),
  ).toBeTrue()
  expect(recordedCliRun?.createdAt).toBe("2026-02-03T04:05:06.000Z")
  expect(recordedCliRun?.runner).toBe("metadata-runner")
})
