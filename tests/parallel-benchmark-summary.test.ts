import { expect, test } from "bun:test"
import { summarizeParallelBenchmark } from "../scripts/parallel-benchmark/parallelBenchmarkSummary"

type RunResult = Parameters<typeof summarizeParallelBenchmark>[0][number]

const makeRun = (
  sampleName: string,
  variant: "baseline" | "parallel",
  elapsedTimeMs: number,
  repeat = 1,
): RunResult => {
  return {
    sampleName,
    repeat,
    variant,
    status: "solved",
    elapsedTimeMs,
    geometryHash: `geometry-${sampleName}`,
    quality: {
      traceCount: 10,
      viaCount: 2,
      drcErrorCount: 0,
      traceLintIssueCounts: { odd_angle: 1 },
    },
  }
}

const makeResults = (
  sampleTimes: Record<string, [number, number]>,
  repetitions = 1,
): RunResult[] => {
  const results: RunResult[] = []
  for (const [sampleName, [baselineTime, parallelTime]] of Object.entries(
    sampleTimes,
  )) {
    for (let repeat = 1; repeat <= repetitions; repeat++) {
      results.push(makeRun(sampleName, "baseline", baselineTime, repeat))
      results.push(makeRun(sampleName, "parallel", parallelTime, repeat))
    }
  }
  return results
}

test("parallel benchmark target requires every sample, complete solves, matching geometry, quality, and both average speedups", () => {
  const options = {
    expectedSamples: ["sample001", "sample002"],
    repetitions: 1,
    timeoutMs: 5_000,
    targetSpeedup: 2,
  }
  const successfulRuns = makeResults({
    sample001: [1_000, 400],
    sample002: [1_000, 400],
  })
  const successful = summarizeParallelBenchmark(successfulRuns, options)
  expect(successful.targetReached).toBe(true)
  expect(successful.fullCoverage).toBe(true)
  expect(successful.allCompleted).toBe(true)
  expect(successful.exactGeometry).toBe(true)
  expect(successful.arithmeticMeanSpeedup).toBeCloseTo(2.5)
  expect(successful.aggregateSpeedup).toBeCloseTo(2.5)

  for (const elapsedTimeMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    expect(() =>
      summarizeParallelBenchmark(
        successfulRuns.map((run) =>
          run.sampleName === "sample001" && run.variant === "parallel"
            ? { ...run, elapsedTimeMs }
            : run,
        ),
        options,
      ),
    ).toThrow("Invalid elapsed time")
  }

  const allSampleNames = Array.from(
    { length: 16 },
    (_, index) => `sample${String(index + 1).padStart(3, "0")}`,
  )
  const allSampleRuns = allSampleNames.flatMap((sampleName) => [
    makeRun(sampleName, "baseline", 1_000),
    makeRun(sampleName, "parallel", 400),
  ])
  expect(
    summarizeParallelBenchmark(allSampleRuns, {
      ...options,
      expectedSamples: allSampleNames,
    }).targetReached,
  ).toBe(true)
  const incomplete = summarizeParallelBenchmark(allSampleRuns.slice(0, -2), {
    ...options,
    expectedSamples: allSampleNames,
  })
  expect(incomplete.fullCoverage).toBe(false)
  expect(incomplete.targetReached).toBe(false)
  expect(incomplete.perSample).toHaveLength(16)

  const missingRepeat = summarizeParallelBenchmark(successfulRuns, {
    ...options,
    repetitions: 2,
  })
  expect(missingRepeat.fullCoverage).toBe(false)
  expect(missingRepeat.targetReached).toBe(false)

  for (const status of ["failed", "timeout", "crashed"] as const) {
    const failedRuns = successfulRuns.map((run) =>
      run.sampleName === "sample001" && run.variant === "parallel"
        ? { ...run, status, elapsedTimeMs: 1 }
        : run,
    )
    const failed = summarizeParallelBenchmark(failedRuns, options)
    expect(failed.fullCoverage).toBe(true)
    expect(failed.allCompleted).toBe(false)
    expect(failed.targetReached).toBe(false)
    expect(failed.arithmeticMeanSpeedup).toBeCloseTo((0.2 + 2.5) / 2)
    expect(failed.aggregateSpeedup).toBeCloseTo(2_000 / 5_400)
  }

  for (const geometryHash of [undefined, "different-geometry"]) {
    const changedGeometry = summarizeParallelBenchmark(
      successfulRuns.map((run) =>
        run.sampleName === "sample001" && run.variant === "parallel"
          ? { ...run, geometryHash }
          : run,
      ),
      options,
    )
    expect(changedGeometry.exactGeometry).toBe(false)
    expect(changedGeometry.targetReached).toBe(false)
  }

  const qualityRegressions: Partial<NonNullable<RunResult["quality"]>>[] = [
    { traceCount: 9 },
    { viaCount: 3 },
    { drcErrorCount: 1 },
    { traceLintIssueCounts: { odd_angle: 2 } },
    { traceLintIssueCounts: { odd_angle: 1, new_issue: 1 } },
  ]
  for (const qualityRegression of qualityRegressions) {
    const changedQuality = summarizeParallelBenchmark(
      successfulRuns.map((run) =>
        run.sampleName === "sample001" && run.variant === "parallel"
          ? {
              ...run,
              quality: {
                traceCount: 10,
                viaCount: 2,
                drcErrorCount: 0,
                traceLintIssueCounts: { odd_angle: 1 },
                ...qualityRegression,
              },
            }
          : run,
      ),
      options,
    )
    expect(changedQuality.targetReached).toBe(false)
  }

  const arithmeticOnly = summarizeParallelBenchmark(
    makeResults({ sample001: [100, 10], sample002: [900, 900] }),
    options,
  )
  expect(arithmeticOnly.arithmeticMeanSpeedup).toBeGreaterThan(2)
  expect(arithmeticOnly.aggregateSpeedup).toBeLessThan(2)
  expect(arithmeticOnly.targetReached).toBe(false)

  const aggregateOnly = summarizeParallelBenchmark(
    makeResults({ sample001: [9_000, 3_000], sample002: [100, 1_000] }),
    { ...options, timeoutMs: 10_000 },
  )
  expect(aggregateOnly.arithmeticMeanSpeedup).toBeLessThan(2)
  expect(aggregateOnly.aggregateSpeedup).toBeGreaterThan(2)
  expect(aggregateOnly.targetReached).toBe(false)

  const repeatedRuns = makeResults(
    { sample001: [1_000, 400], sample002: [1_000, 400] },
    3,
  ).map((run) =>
    run.repeat === 3 ? { ...run, elapsedTimeMs: 4_900 } : run,
  )
  const repeated = summarizeParallelBenchmark(repeatedRuns, {
    ...options,
    repetitions: 3,
  })
  expect(repeated.targetReached).toBe(true)
  expect(repeated.arithmeticMeanSpeedup).toBeCloseTo(2.5)
  expect(repeated.aggregateSpeedup).toBeCloseTo(2.5)

  const coveredRuns = successfulRuns.map((run): RunResult => ({
    ...run,
    geometryHash: run.variant === "parallel" ? "alternative-geometry" : run.geometryHash,
    quality: {
      ...run.quality!,
      traceCount: run.variant === "parallel" ? 9 : 10,
      viaCount: run.variant === "parallel" ? 3 : 2,
      connectionCoverage: {
        requiredNetCount: 2, requiredPairCount: 3, coveredNetCount: 2,
        uncoveredNetCount: 0, missingPortCount: 0, singletonNetCount: 1, errorCount: 0,
      },
    },
  }))
  const alternatives = [
    { highDensityPolicy: "first-valid" as const },
    { pathingStrategy: "landmark" as const },
    { pathingStrategy: "negotiated" as const },
    { pathingStrategy: "goal-balls" as const },
  ]
  for (const alternative of alternatives) {
    const alternativeSummary = summarizeParallelBenchmark(coveredRuns, { ...options, ...alternative })
    expect(alternativeSummary.targetReached).toBe(true)
    expect(alternativeSummary.exactGeometry).toBe(false)
    expect(alternativeSummary.geometryRequired).toBe(false)
    expect(alternativeSummary.connectionCoveragePreserved).toBe(true)
    expect(summarizeParallelBenchmark(successfulRuns, { ...options, ...alternative }).targetReached).toBe(false)
    for (const coverageRegression of [
      { requiredNetCount: 3 }, { requiredPairCount: 4 }, { coveredNetCount: 1 },
      { uncoveredNetCount: 1 }, { missingPortCount: 1 }, { errorCount: 1 },
      { requiredNetCount: -1 }, { singletonNetCount: Number.NaN },
    ]) {
      const failedCoverage = coveredRuns.map((run): RunResult => run.variant === "parallel" ? {
        ...run,
        quality: { ...run.quality!, connectionCoverage: { ...run.quality!.connectionCoverage!, ...coverageRegression } },
      } : run)
      const summary = summarizeParallelBenchmark(failedCoverage, { ...options, ...alternative })
      expect(summary.connectionCoveragePreserved).toBe(false)
      expect(summary.targetReached).toBe(false)
    }
    const extraDrc = coveredRuns.map((run): RunResult => run.variant === "parallel" ? {
      ...run, quality: { ...run.quality!, drcErrorCount: 1 },
    } : run)
    expect(summarizeParallelBenchmark(extraDrc, { ...options, ...alternative }).targetReached).toBe(false)
  }
  expect(summarizeParallelBenchmark(coveredRuns, options).targetReached).toBe(false)
})
