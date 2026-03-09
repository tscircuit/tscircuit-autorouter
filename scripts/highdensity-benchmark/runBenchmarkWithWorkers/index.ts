import { BenchmarkWorkerPool } from "./BenchmarkWorkerPool.ts"
import { RunBenchmarkOptions, RunBenchmarkResult } from "./shared.ts"

export const runBenchmarkWithWorkers = async (
  options: RunBenchmarkOptions,
): Promise<RunBenchmarkResult> => {
  return BenchmarkWorkerPool.run(options)
}
