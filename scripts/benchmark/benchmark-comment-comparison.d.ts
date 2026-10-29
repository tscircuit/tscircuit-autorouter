import type { BenchmarkReport } from "./benchmark-types"

export declare const isNetworkedColdHotReport: (
  report: BenchmarkReport | null | undefined,
) => boolean

export type BenchmarkComparisonInput = {
  mainReport: BenchmarkReport | null
  prReport: BenchmarkReport | null
  fallbackText?: string
  maxLength?: number
}

export function renderBenchmarkComparison(
  input: BenchmarkComparisonInput,
): string[]
