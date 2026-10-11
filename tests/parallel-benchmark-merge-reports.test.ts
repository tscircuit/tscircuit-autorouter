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
  expect((merged.metadata.options as Record<string, unknown>).pathingStrategy).toBe("adaptive-bitset")
  expect((merged.metadata.options as Record<string, unknown>).highDensityPolicy).toBe("ordered")
  expect((merged.metadata.options as Record<string, unknown>).physicalRouting).toBe(false)
  expect(merged.summary.physicalRouting).toBe(false)
  expect(sources).toEqual(makeMergeSources())
  const equivalentLegacyPhysicalFlag = makeMergeSources()
  Object.assign(equivalentLegacyPhysicalFlag[0]!.report.metadata.options as Record<string, unknown>, { physicalRouting: false })
  expect(mergeParallelBenchmarkReports(equivalentLegacyPhysicalFlag).summary.targetReached).toBe(true)
  const physicalSources = makeMergeSources()
  for (const source of physicalSources) {
    Object.assign(source.report.metadata.options as Record<string, unknown>, { physicalRouting: true, pathingStrategy: "indexed" })
    for (const result of source.report.results) {
      result.quality!.connectionCoverage = {
        requiredNetCount: 2, requiredPairCount: 3, coveredNetCount: 2,
        uncoveredNetCount: 0, missingPortCount: 0, singletonNetCount: 1, errorCount: 0,
      }
      if (result.variant === "parallel") result.geometryHash = "physically-correct-alternative"
    }
  }
  const physicalReport = mergeParallelBenchmarkReports(physicalSources)
  expect((physicalReport.metadata.options as Record<string, unknown>).physicalRouting).toBe(true)
  expect(physicalReport.summary.physicalRouting).toBe(true)
  expect(physicalReport.summary.geometryRequired).toBe(false)
  expect(physicalReport.summary.exactGeometry).toBe(false)
  expect(physicalReport.summary.connectionCoveragePreserved).toBe(true)
  expect(physicalReport.summary.targetReached).toBe(true)
  Object.assign(physicalSources[0]!.report.metadata.options as Record<string, unknown>, { physicalRouting: false })
  expect(() => mergeParallelBenchmarkReports(physicalSources)).toThrow("Incompatible benchmark options")
  Object.assign(physicalSources[0]!.report.metadata.options as Record<string, unknown>, { physicalRouting: "true" })
  expect(() => mergeParallelBenchmarkReports(physicalSources)).toThrow("Invalid physicalRouting")
  expect(merged.metadata.harnessVersion).toBe(1)
  expect(merged.metadata.drcIncludesBoardClearance).toBe(false)
  expect(merged.metadata.coveragePolicyVersion).toBe(1)
  expect(merged.metadata.physicalPadSource).toBe("srj-obstacles")
  const parityPolicySources = makeMergeSources()
  for (const source of parityPolicySources) Object.assign(source.report.metadata, {
    harnessVersion: 3, drcIncludesBoardClearance: true, coveragePolicyVersion: 2,
  })
  const parityPolicy = mergeParallelBenchmarkReports(parityPolicySources)
  expect(parityPolicy.metadata.coveragePolicyVersion).toBe(2)
  expect(parityPolicy.summary.coverageAcceptanceMode).toBe("baseline-parity")
  Object.assign(parityPolicySources[0]!.report.metadata, { harnessVersion: 2, coveragePolicyVersion: 1 })
  expect(() => mergeParallelBenchmarkReports(parityPolicySources)).toThrow("Incompatible benchmark quality policy")
  const cadPolicySources = makeMergeSources()
  for (const source of cadPolicySources) Object.assign(source.report.metadata, {
    harnessVersion: 4, drcIncludesBoardClearance: true, coveragePolicyVersion: 2,
    physicalPadSource: "original-circuit-json", physicalPadHashes: { ...source.report.metadata.datasetHashes as Record<string, unknown> },
  })
  const cadPolicy = mergeParallelBenchmarkReports(cadPolicySources)
  expect(cadPolicy.metadata.physicalPadSource).toBe("original-circuit-json")
  expect(cadPolicy.metadata.physicalPadHashes).toEqual(cadPolicySources[0]!.report.metadata.physicalPadHashes)
  expect(cadPolicy.summary.targetReached).toBe(true)
  const firstPadHashes = cadPolicySources[0]!.report.metadata.physicalPadHashes as Record<string, unknown>
  firstPadHashes.sample001 = "f".repeat(64)
  expect(() => mergeParallelBenchmarkReports(cadPolicySources)).toThrow("Incompatible physical pad hashes")
  delete firstPadHashes.sample001
  expect(() => mergeParallelBenchmarkReports(cadPolicySources)).toThrow("All 16 original CAD physical pad hashes are required")
  Object.assign(cadPolicySources[0]!.report.metadata, { physicalPadSource: "srj-obstacles" })
  expect(() => mergeParallelBenchmarkReports(cadPolicySources)).toThrow("Invalid benchmark quality policy")
  const boardInclusiveSources = makeMergeSources()
  for (const source of boardInclusiveSources) Object.assign(source.report.metadata, {
    harnessVersion: 2, drcIncludesBoardClearance: true,
  })
  const boardInclusive = mergeParallelBenchmarkReports(boardInclusiveSources)
  expect(boardInclusive.metadata.harnessVersion).toBe(2)
  expect(boardInclusive.metadata.drcIncludesBoardClearance).toBe(true)
  delete boardInclusiveSources[0]!.report.metadata.harnessVersion
  delete boardInclusiveSources[0]!.report.metadata.drcIncludesBoardClearance
  expect(() => mergeParallelBenchmarkReports(boardInclusiveSources)).toThrow("Incompatible benchmark quality policy")
  Object.assign(boardInclusiveSources[0]!.report.metadata, { harnessVersion: 2, drcIncludesBoardClearance: false })
  expect(() => mergeParallelBenchmarkReports(boardInclusiveSources)).toThrow("Invalid benchmark quality policy")

  for (const pathingStrategy of ["indexed", "adaptive-bitset", "cached-cost", "landmark", "negotiated", "goal-balls"]) {
    const strategySources = makeMergeSources()
    for (const source of strategySources) {
      (source.report.metadata.options as Record<string, unknown>).pathingStrategy = pathingStrategy
      for (const result of source.report.results) {
        result.quality!.connectionCoverage = {
          requiredNetCount: 2, requiredPairCount: 3, coveredNetCount: 2,
          uncoveredNetCount: 0, missingPortCount: 0, singletonNetCount: 1, errorCount: 0,
        }
      }
    }
    const strategyReport = mergeParallelBenchmarkReports(strategySources)
    expect((strategyReport.metadata.options as Record<string, unknown>).pathingStrategy).toBe(pathingStrategy)
    expect(strategyReport.summary.targetReached).toBe(true)
  }
  const equivalentLegacyStrategy = makeMergeSources()
  Object.assign(equivalentLegacyStrategy[0]!.report.metadata.options as Record<string, unknown>, { pathingStrategy: "adaptive-bitset" })
  expect(mergeParallelBenchmarkReports(equivalentLegacyStrategy).summary.targetReached).toBe(true)
  const mismatchedStrategy = makeMergeSources()
  Object.assign(mismatchedStrategy[0]!.report.metadata.options as Record<string, unknown>, { pathingStrategy: "indexed" })
  expect(() => mergeParallelBenchmarkReports(mismatchedStrategy)).toThrow("Incompatible benchmark options")
  const invalidStrategy = makeMergeSources()
  Object.assign(invalidStrategy[0]!.report.metadata.options as Record<string, unknown>, { pathingStrategy: "unknown" })
  expect(() => mergeParallelBenchmarkReports(invalidStrategy)).toThrow("Invalid pathingStrategy")
  const equivalentLegacyPolicy = makeMergeSources()
  Object.assign(equivalentLegacyPolicy[0]!.report.metadata.options as Record<string, unknown>, { highDensityPolicy: "ordered" })
  expect(mergeParallelBenchmarkReports(equivalentLegacyPolicy).summary.targetReached).toBe(true)
  const mismatchedPolicy = makeMergeSources()
  Object.assign(mismatchedPolicy[0]!.report.metadata.options as Record<string, unknown>, { highDensityPolicy: "first-valid" })
  expect(() => mergeParallelBenchmarkReports(mismatchedPolicy)).toThrow("Incompatible benchmark options")
  const invalidPolicy = makeMergeSources()
  Object.assign(invalidPolicy[0]!.report.metadata.options as Record<string, unknown>, { highDensityPolicy: "invalid" })
  expect(() => mergeParallelBenchmarkReports(invalidPolicy)).toThrow("Invalid highDensityPolicy")

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
