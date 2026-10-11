import { expect, test } from "bun:test"
import { mergeParallelBenchmarkReports } from "../scripts/parallel-benchmark/mergeReports"

type ReportSource = Parameters<typeof mergeParallelBenchmarkReports>[0][number]

const makeMergeSources = (): ReportSource[] => {
  const sampleGroups = [
    [1, 2, 3, 4],
    [5, 6, 7, 8],
    [9, 10, 11],
    [12, 13, 14],
    [15, 16],
  ]
  const datasetHashes = Object.fromEntries(
    Array.from({ length: 16 }, (_, index) => [
      `sample${String(index + 1).padStart(3, "0")}`,
      String(index + 1).padStart(64, "0"),
    ]),
  )
  return sampleGroups.map((sampleNumbers, sourceIndex) => {
    const results: ReportSource["report"]["results"] = []
    for (const sampleNumber of sampleNumbers) {
      const sampleName = `sample${String(sampleNumber).padStart(3, "0")}`
      for (let repeat = 1; repeat <= 3; repeat++) {
        for (const variant of ["baseline", "parallel"] as const) {
          results.push({
            sampleName,
            repeat,
            variant,
            status: "solved",
            elapsedTimeMs: variant === "baseline" ? 1_000 : 400,
            geometryHash: `geometry-${sampleName}`,
            quality: {
              traceCount: 10,
              viaCount: 2,
              drcErrorCount: 0,
              traceLintIssueCounts: { odd_angle: 1 },
            },
          })
        }
      }
    }
    return {
      sourcePath: `/reports/subset-${sourceIndex}.json`,
      installedDependencyHash: "installed-dependencies",
      report: {
        metadata: {
          revision: "a".repeat(40),
          baselineRevision: "b".repeat(40),
          dataset: "srj18",
          datasetDependency: "git+https://github.com/tscircuit/dataset-srj18.git#100e8957ce789b5b288e14c476dc83f4efc5214b",
          datasetHashes: { ...datasetHashes },
          runtime: { bun: "1.3.10", node: "24.3.0" },
          cpuModel: "unknown",
          availableParallelism: 4,
          timing: "construction, solve, pool startup, and disposal",
          qualityValidationTimeoutMs: 180_000,
          runner: `blacksmith-4vcpu-ubuntu-2404-arm-test-${sourceIndex}`,
          options: {
            repetitions: 3,
            timeoutMs: 180_000,
            effort: 1,
            workerCount: 4,
            parallelPathSimplification: true,
            targetSpeedup: 2,
            variants: ["baseline", "parallel"],
            sampleNumbers,
            outDir: `/reports/subset-${sourceIndex}`,
          },
        },
        results,
      },
    }
  })
}

test("parallel benchmark reports merge only comparable complete same-runner sample pairs", () => {
  const sources = makeMergeSources()
  const merged = mergeParallelBenchmarkReports(sources)
  expect(merged.sources).toHaveLength(5)
  expect(merged.results).toHaveLength(96)
  expect(merged.summary.perSample).toHaveLength(16)
  expect(merged.summary.fullCoverage).toBe(true)
  expect(merged.summary.allCompleted).toBe(true)
  expect(merged.summary.exactGeometry).toBe(true)
  expect(merged.summary.qualityPreserved).toBe(true)
  expect(merged.summary.targetReached).toBe(true)
  expect(merged.summary.arithmeticMeanSpeedup).toBeCloseTo(2.5)
  expect(merged.summary.aggregateSpeedup).toBeCloseTo(2.5)
  expect(merged.metadata.installedDependenciesVerified).toBe(true)
  expect(sources).toEqual(makeMergeSources())

  const reorderedSources = makeMergeSources()
  reorderedSources[1]!.report.metadata.runtime = { node: "24.3.0", bun: "1.3.10" }
  reorderedSources[1]!.report.metadata.datasetHashes = Object.fromEntries(
    Object.entries(
      reorderedSources[1]!.report.metadata.datasetHashes as Record<string, string>,
    ).reverse(),
  )
  const reorderedOptions = reorderedSources[1]!.report.metadata.options as Record<string, unknown>
  reorderedOptions.variants = ["parallel", "baseline"]
  reorderedOptions.sampleNumbers = [8, 7, 6, 5]
  expect(mergeParallelBenchmarkReports(reorderedSources).summary.targetReached).toBe(true)

  for (const status of ["failed", "timeout", "crashed"] as const) {
    const failedSources = makeMergeSources()
    const failedRun = failedSources[0]!.report.results.find(
      (run) => run.variant === "parallel",
    )!
    Object.assign(failedRun, { status, elapsedTimeMs: 1 })
    const failed = mergeParallelBenchmarkReports(failedSources)
    expect(failed.summary.fullCoverage).toBe(true)
    expect(failed.summary.allCompleted).toBe(false)
    expect(failed.summary.targetReached).toBe(false)
  }

  const noDependencyHashes = makeMergeSources()
  for (const source of noDependencyHashes) delete source.installedDependencyHash
  const unverified = mergeParallelBenchmarkReports(noDependencyHashes)
  expect(unverified.summary.fullCoverage).toBe(true)
  expect(unverified.metadata.installedDependenciesVerified).toBe(false)

  const missingDependencyHash = makeMergeSources()
  delete missingDependencyHash[1]!.installedDependencyHash
  expect(() => mergeParallelBenchmarkReports(missingDependencyHash)).toThrow()

  const differentDependencyHash = makeMergeSources()
  differentDependencyHash[1]!.installedDependencyHash = "different-dependencies"
  expect(() => mergeParallelBenchmarkReports(differentDependencyHash)).toThrow()

  const metadataMismatches: Record<string, unknown>[] = [
    { revision: "c".repeat(40) },
    { baselineRevision: "c".repeat(40) },
    { dataset: "srj19" },
    { datasetDependency: "different-dataset-revision" },
    { datasetHashes: { sample001: "different-hash" } },
    { runtime: { bun: "1.3.11", node: "24.3.0" } },
    { cpuModel: "different-cpu" },
    { availableParallelism: 8 },
    { timing: "solve-only" },
    { qualityValidationTimeoutMs: 90_000 },
    { runner: "unrestricted-local-machine" },
  ]
  for (const mismatch of metadataMismatches) {
    const mismatchedSources = makeMergeSources()
    Object.assign(mismatchedSources[1]!.report.metadata, mismatch)
    expect(() => mergeParallelBenchmarkReports(mismatchedSources)).toThrow()
  }

  const unrestrictedSources = makeMergeSources()
  for (const source of unrestrictedSources) {
    source.report.metadata.availableParallelism = 8
  }
  expect(() => mergeParallelBenchmarkReports(unrestrictedSources)).toThrow()

  const optionMismatches: Record<string, unknown>[] = [
    { repetitions: 2 },
    { timeoutMs: 90_000 },
    { effort: 0.5 },
    { workerCount: 3 },
    { parallelPathSimplification: false },
    { targetSpeedup: 3 },
    { variants: ["parallel"] },
    { futureRoutingFlag: true },
  ]
  for (const mismatch of optionMismatches) {
    const mismatchedSources = makeMergeSources()
    Object.assign(
      mismatchedSources[1]!.report.metadata.options as Record<string, unknown>,
      mismatch,
    )
    expect(() => mergeParallelBenchmarkReports(mismatchedSources)).toThrow()
  }

  const duplicateRun = makeMergeSources()
  duplicateRun[0]!.report.results.push({ ...duplicateRun[0]!.report.results[0]! })
  expect(() => mergeParallelBenchmarkReports(duplicateRun)).toThrow()

  const duplicatePath = makeMergeSources()
  duplicatePath[1]!.sourcePath = duplicatePath[0]!.sourcePath
  expect(() => mergeParallelBenchmarkReports(duplicatePath)).toThrow()

  const duplicateSampleSources = makeMergeSources()
  duplicateSampleSources.push(structuredClone(duplicateSampleSources[0]!))
  duplicateSampleSources[5]!.sourcePath = "/reports/duplicate-sample.json"
  expect(() => mergeParallelBenchmarkReports(duplicateSampleSources)).toThrow()

  const incompleteSource = makeMergeSources()
  incompleteSource[0]!.report.results.pop()
  expect(() => mergeParallelBenchmarkReports(incompleteSource)).toThrow()

  const splitSources = makeMergeSources()
  const splitSource = splitSources.shift()!
  splitSources.push(
    {
      ...structuredClone(splitSource),
      sourcePath: "/reports/baseline-only.json",
      report: {
        metadata: structuredClone(splitSource.report.metadata),
        results: splitSource.report.results.filter((run) => run.variant === "baseline"),
      },
    },
    {
      ...structuredClone(splitSource),
      sourcePath: "/reports/parallel-only.json",
      report: {
        metadata: {
          ...structuredClone(splitSource.report.metadata),
          runner: "blacksmith-4vcpu-ubuntu-2404-arm-different-runner",
        },
        results: splitSource.report.results.filter((run) => run.variant === "parallel"),
      },
    },
  )
  expect(() => mergeParallelBenchmarkReports(splitSources)).toThrow()

  const invalidRunFields: Record<string, unknown>[] = [
    { sampleName: "sample017" },
    { repeat: 0 },
    { repeat: 4 },
    { repeat: 1.5 },
    { variant: "unknown" },
    { status: "unknown" },
  ]
  for (const fields of invalidRunFields) {
    const invalidSources = makeMergeSources()
    Object.assign(invalidSources[0]!.report.results[0]!, fields)
    expect(() => mergeParallelBenchmarkReports(invalidSources)).toThrow()
  }

  for (const elapsedTimeMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const invalidSources = makeMergeSources()
    invalidSources[0]!.report.results[0]!.elapsedTimeMs = elapsedTimeMs
    expect(() => mergeParallelBenchmarkReports(invalidSources)).toThrow("Invalid elapsed time")
  }

  const incompleteDataset = mergeParallelBenchmarkReports(makeMergeSources().slice(0, -1))
  expect(incompleteDataset.summary.fullCoverage).toBe(false)
  expect(incompleteDataset.summary.targetReached).toBe(false)
  expect(incompleteDataset.summary.perSample).toHaveLength(16)
})
