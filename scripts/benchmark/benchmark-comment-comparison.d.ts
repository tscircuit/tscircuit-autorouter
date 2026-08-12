import type { BenchmarkReport } from "./benchmark-types"

export type BenchmarkComparisonInput = {
  mainReport: BenchmarkReport | null
  prReport: BenchmarkReport | null
  fallbackText?: string
  maxLength?: number
}

export function renderBenchmarkComparison(
  input: BenchmarkComparisonInput,
): string[]
