import type { BenchmarkReport } from "./benchmark-types"

export declare function renderBenchmarkStageTimings(
  report: BenchmarkReport | null | undefined,
  label: string,
): string[]
