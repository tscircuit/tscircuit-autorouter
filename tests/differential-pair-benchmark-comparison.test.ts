import { expect, test } from "bun:test"
import { compareResults } from "../scripts/differential-pair-benchmark/compareResults"
import type { RunResults } from "../scripts/differential-pair-benchmark/types"

test("baseline permits solver revisions but rejects incompatible measurement contracts and datasets", () => {
  const run: RunResults = {
    schemaVersion: 1,
    metricVersion: "v2",
    metricImplementationSha256: "metric-code",
    createdAt: "2026-09-28",
    gitCommit: "old",
    workingTreeSha256: "old-tree",
    datasetSha256: "dataset",
    dependencyLockSha256: "lock",
    bunVersion: "1",
    host: { cpu: "cpu", platform: "linux", architecture: "x64" },
    config: { solver: "solver", effort: 1, timeoutMs: 60000 },
    samples: [],
  }
  const revised = { ...run, gitCommit: "new", workingTreeSha256: "new-tree" }
  expect(
    compareResults({
      current: { ...revised, dependencyLockSha256: "new-lock" },
      baseline: run,
      allowDependencyChange: true,
    }).dependencyChanged,
  ).toBe(true)
  expect(() =>
    compareResults({
      current: { ...revised, dependencyLockSha256: "new-lock" },
      baseline: run,
    }),
  ).toThrow("dependencyLockSha256")
  expect(
    compareResults({ current: revised, baseline: run }).runtimeComparable,
  ).toBe(true)
  expect(() =>
    compareResults({
      current: { ...revised, datasetSha256: "different" },
      baseline: run,
    }),
  ).toThrow("datasetSha256")
  expect(() =>
    compareResults({
      current: { ...revised, metricImplementationSha256: "changed-metrics" },
      baseline: run,
    }),
  ).toThrow("metricImplementationSha256")
  expect(() =>
    compareResults({
      current: { ...revised, metricVersion: "v3" },
      baseline: run,
    }),
  ).toThrow("metricVersion")
  expect(() =>
    compareResults({
      current: { ...revised, config: { ...run.config, effort: 2 } },
      baseline: run,
    }),
  ).toThrow("config")
  expect(
    compareResults({
      current: { ...revised, host: { ...run.host, cpu: "different" } },
      baseline: run,
    }).runtimeComparable,
  ).toBe(false)
})
