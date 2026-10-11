import type {
  ParallelBenchmarkResult,
  ParallelBenchmarkSummary,
  ParallelBenchmarkSummaryOptions,
} from "./parallelBenchmarkTypes"
import stableStringify from "fast-json-stable-stringify"

export const summarizeParallelBenchmark = (
  results: ParallelBenchmarkResult[],
  options: ParallelBenchmarkSummaryOptions,
): ParallelBenchmarkSummary => {
  const highDensityPolicy = options.highDensityPolicy ?? "ordered"
  const pathingStrategy = options.pathingStrategy ?? "indexed"
  const physicalRouting = options.physicalRouting ?? false
  if (typeof physicalRouting !== "boolean") throw new Error("Invalid physical routing flag")
  if (highDensityPolicy !== "ordered" && highDensityPolicy !== "first-valid") {
    throw new Error("Invalid high density policy")
  }
  if (!["indexed", "adaptive-bitset", "cached-cost", "landmark", "negotiated", "goal-balls"].includes(pathingStrategy)) {
    throw new Error("Invalid pathing strategy")
  }
  const geometryRequired = !physicalRouting && highDensityPolicy === "ordered" && pathingStrategy !== "landmark" && pathingStrategy !== "negotiated" && pathingStrategy !== "goal-balls"
  const coverageAcceptanceMode = geometryRequired ? "baseline-parity" : "full-physical-completion"
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
    const connectionCoveragePreserved = pairs.every((pair) => {
      const a = pair.baseline?.quality?.connectionCoverage
      const b = pair.parallel?.quality?.connectionCoverage
      // Legacy ordered reports did not collect coverage. Exact parity retains
      // their original gate; changed-geometry runs require explicit validation.
      if (!a && !b) return geometryRequired && exactGeometry
      if (!a || !b) return false
      const countFields = [
        "requiredNetCount", "requiredPairCount", "coveredNetCount", "uncoveredNetCount",
        "missingPortCount", "singletonNetCount", "errorCount",
      ] as const
      if ([a, b].some((coverage) => countFields.some((field) =>
        !Number.isInteger(coverage[field]) || coverage[field] < 0,
      ))) return false
      // An immutable-output performance rewrite preserves the baseline's
      // recorded physical behavior, including visible original omissions.
      if (geometryRequired && exactGeometry) return stableStringify(a) === stableStringify(b)
      return a.requiredNetCount === b.requiredNetCount &&
        a.requiredPairCount === b.requiredPairCount &&
        b.coveredNetCount === b.requiredNetCount &&
        b.uncoveredNetCount === 0 && b.missingPortCount === 0 &&
        b.errorCount === 0 && b.errorCount <= a.errorCount
    })
    const qualityPreserved = pairs.every((pair) => {
      const a = pair.baseline?.quality
      const b = pair.parallel?.quality
      if (!a || !b) return false
      const lintTypes = new Set([
        ...Object.keys(a.traceLintIssueCounts),
        ...Object.keys(b.traceLintIssueCounts),
      ])
      return (
        (!geometryRequired || (a.traceCount === b.traceCount && a.viaCount === b.viaCount)) &&
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
      qualityPreserved: qualityPreserved && connectionCoveragePreserved,
      connectionCoveragePreserved,
    }
  })
  const allCompleted = fullCoverage && results.every((result) => result.status === "solved")
  const exactGeometry = fullCoverage && perSample.every((sample) => sample.exactGeometry)
  const qualityPreserved = fullCoverage && perSample.every((sample) => sample.qualityPreserved)
  const connectionCoveragePreserved = fullCoverage && perSample.every((sample) => sample.connectionCoveragePreserved)
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
    connectionCoveragePreserved,
    highDensityPolicy,
    pathingStrategy,
    physicalRouting,
    geometryRequired,
    coverageAcceptanceMode,
    arithmeticMeanSpeedup,
    aggregateSpeedup,
    geometricMeanSpeedup,
    targetReached:
      allCompleted && (!geometryRequired || exactGeometry) && qualityPreserved &&
      arithmeticMeanSpeedup >= options.targetSpeedup &&
      aggregateSpeedup >= options.targetSpeedup,
    perSample,
  }
}
