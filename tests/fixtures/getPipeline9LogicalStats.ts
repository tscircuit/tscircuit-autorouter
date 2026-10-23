const ELAPSED_DIAGNOSTIC_KEYS = [
  "learnedComputeElapsedMs",
  "learnedComputeValidationElapsedMs",
  "learnedComputePortfolioOverheadMs",
] as const

/** Keep every logical statistic while checking actual elapsed observations. */
export function getPipeline9LogicalStats(
  stats: Record<string, unknown>,
): Record<string, unknown> {
  const logicalStats = { ...stats }
  for (const key of ELAPSED_DIAGNOSTIC_KEYS) {
    if (!Object.hasOwn(stats, key)) continue
    const value = stats[key]
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new Error(`Invalid elapsed diagnostic ${key}: ${String(value)}`)
    }
    delete logicalStats[key]
  }
  return logicalStats
}
