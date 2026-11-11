import { expect, test } from "bun:test"
import {
  createBenchmarkHistoryDashboardIndex,
  type BenchmarkHistoryRun,
} from "../scripts/benchmark/benchmark-history"
import { createThreadComparisonReport } from "./fixtures/threadComparisonReport"

test("dashboard points keep different CPUs and unrecorded hardware separate", () => {
  const runs = ["ARM gen1", "Ampere gen2", "unknown"].map(
    (cpuModel, index): BenchmarkHistoryRun => {
      const report = createThreadComparisonReport(1_000 + index * 100, 1)
      report.runtime!.cpuModel = cpuModel
      return {
        version: 1,
        runId: `${index + 1}-1`,
        workflowRunId: String(index + 1),
        workflowRunAttempt: 1,
        runUrl: `https://github.com/tscircuit/tscircuit-autorouter/actions/runs/${index + 1}`,
        commitSha: "abc123",
        createdAt: `2026-11-11T10:0${index}:00.000Z`,
        runner: "blacksmith-32vcpu-ubuntu-2404-arm",
        metadata: {},
        report,
      }
    },
  )
  const { points } = createBenchmarkHistoryDashboardIndex(runs)
  expect(points[0].hardwareKey).not.toBe(points[1].hardwareKey)
  expect(points[0].hardwareLabel).toContain("ARM gen1")
  expect(points[1].hardwareLabel).toContain("Ampere gen2")
  expect(points[2].hardwareKey).toBeNull()
  expect(points[2].hardwareLabel).toBe("Unrecorded hardware")
  expect(points.map((point) => point.p50TimeMs)).toEqual([1_000, 1_100, 1_200])
})
