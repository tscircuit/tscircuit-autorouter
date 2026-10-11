import type {
  ParallelBenchmarkResult,
  ParallelBenchmarkSummary,
  ParallelBenchmarkSummaryOptions,
} from "./parallelBenchmarkTypes"

export const summarizeParallelBenchmark = (
  results: ParallelBenchmarkResult[],
  options: ParallelBenchmarkSummaryOptions,
): ParallelBenchmarkSummary => {
  for (const result of results) {
    if (
      result.status === "solved" &&
      (!Number.isFinite(result.elapsedTimeMs) || result.elapsedTimeMs <= 0)
    ) {
      throw new Error(
        `Invalid elapsed time for ${result.sampleName}:${result.repeat}:${result.variant}`,
      )
    }
  }
  const expectedCount = options.expectedSamples.length * options.repetitions * 2
  const keys = new Set(
    results.map((result) => `${result.sampleName}:${result.repeat}:${result.variant}`),
  )
  const fullCoverage =
    results.length === expectedCount &&
    keys.size === expectedCount &&
    options.expectedSamples.every((sampleName) =>
      Array.from({ length: options.repetitions }, (_, index) => index + 1).every(
        (repeat) =>
          keys.has(`${sampleName}:${repeat}:baseline`) &&
          keys.has(`${sampleName}:${repeat}:parallel`),
      ),
    )
  const median = (values: number[]): number => {
    const sorted = [...values].sort((a, b) => a - b)
    const middle = Math.floor(sorted.length / 2)
    if (sorted.length === 0) return options.timeoutMs
    if (sorted.length % 2 === 1) return sorted[middle]!
    return (sorted[middle - 1]! + sorted[middle]!) / 2
  }
  const perSample = options.expectedSamples.map((sampleName) => {
    const baseline = results.filter(
      (result) => result.sampleName === sampleName && result.variant === "baseline",
    )
    const parallel = results.filter(
      (result) => result.sampleName === sampleName && result.variant === "parallel",
    )
    const scoredTimes = (runs: ParallelBenchmarkResult[]): number[] =>
      Array.from({ length: options.repetitions }, (_, index) => {
        const run = runs.find((result) => result.repeat === index + 1)
        return run?.status === "solved" ? run.elapsedTimeMs : options.timeoutMs
      })
    const baselineTimeMs = median(scoredTimes(baseline))
    const parallelTimeMs = median(scoredTimes(parallel))
    const pairs = Array.from({ length: options.repetitions }, (_, index) => ({
      baseline: baseline.find((result) => result.repeat === index + 1),
      parallel: parallel.find((result) => result.repeat === index + 1),
    }))
    const exactGeometry = pairs.every(
      (pair) =>
        pair.baseline?.geometryHash !== undefined &&
        pair.baseline.geometryHash === pair.parallel?.geometryHash,
    )
    const qualityPreserved = pairs.every((pair) => {
      const a = pair.baseline?.quality
      const b = pair.parallel?.quality
      if (!a || !b) return false
      const lintTypes = new Set([
        ...Object.keys(a.traceLintIssueCounts),
        ...Object.keys(b.traceLintIssueCounts),
      ])
      return (
        a.traceCount === b.traceCount &&
        a.viaCount === b.viaCount &&
        b.drcErrorCount <= a.drcErrorCount &&
        [...lintTypes].every(
          (type) =>
            (b.traceLintIssueCounts[type] ?? 0) <=
            (a.traceLintIssueCounts[type] ?? 0),
        )
      )
    })
    return {
      sampleName,
      baselineTimeMs,
      parallelTimeMs,
      speedup: baselineTimeMs / parallelTimeMs,
      baselineSolved: baseline.filter((result) => result.status === "solved").length,
      parallelSolved: parallel.filter((result) => result.status === "solved").length,
      exactGeometry,
      qualityPreserved,
    }
  })
  const allCompleted = fullCoverage && results.every((result) => result.status === "solved")
  const exactGeometry = fullCoverage && perSample.every((sample) => sample.exactGeometry)
  const qualityPreserved = fullCoverage && perSample.every((sample) => sample.qualityPreserved)
  const arithmeticMeanSpeedup =
    perSample.reduce((sum, sample) => sum + sample.speedup, 0) / perSample.length
  const aggregateSpeedup =
    perSample.reduce((sum, sample) => sum + sample.baselineTimeMs, 0) /
    perSample.reduce((sum, sample) => sum + sample.parallelTimeMs, 0)
  const geometricMeanSpeedup = Math.exp(
    perSample.reduce((sum, sample) => sum + Math.log(sample.speedup), 0) /
      perSample.length,
  )
  return {
    fullCoverage,
    allCompleted,
    exactGeometry,
    qualityPreserved,
    arithmeticMeanSpeedup,
    aggregateSpeedup,
    geometricMeanSpeedup,
    targetReached:
      allCompleted && exactGeometry && qualityPreserved &&
      arithmeticMeanSpeedup >= options.targetSpeedup &&
      aggregateSpeedup >= options.targetSpeedup,
    perSample,
  }
}
