import * as os from "node:os"
import type { BenchmarkRuntimeMetadata } from "./benchmark-types"

// Dataset 18 processes have measured peaks near 6 GiB. Leave room for each
// solver's heap and background GC instead of filling every CPU with a board.
export const BENCHMARK_MEMORY_BUDGET_PER_WORKER_BYTES = 6 * 1024 ** 3

export const getBenchmarkMemoryLimit = (): number => {
  const hostMemory = os.totalmem()
  const constrainedMemory = process.constrainedMemory()
  return constrainedMemory > 0
    ? Math.min(hostMemory, constrainedMemory)
    : hostMemory
}

export const getBenchmarkConcurrency = (
  availableParallelism = os.availableParallelism(),
  memoryLimitBytes = getBenchmarkMemoryLimit(),
): number => {
  // Bun accounts for CPU quota and affinity. Also respect container memory;
  // page reclamation can make otherwise healthy solves miss their deadline.
  const memoryWorkerLimit = Math.floor(
    memoryLimitBytes / BENCHMARK_MEMORY_BUDGET_PER_WORKER_BYTES,
  )
  return Math.max(1, Math.min(availableParallelism, memoryWorkerLimit))
}

export const getBenchmarkRuntimeMetadata = (
  requestedConcurrency: number,
  workerCount: number,
): BenchmarkRuntimeMetadata => {
  const cpus = os.cpus()
  return {
    bunVersion: Bun.version,
    platform: process.platform,
    architecture: process.arch,
    cpuModel: cpus[0]?.model ?? "unknown",
    logicalCpuCount: cpus.length,
    availableParallelism: os.availableParallelism(),
    memoryLimitBytes: getBenchmarkMemoryLimit(),
    memoryBudgetPerWorkerBytes: BENCHMARK_MEMORY_BUDGET_PER_WORKER_BYTES,
    requestedConcurrency,
    workerCount,
  }
}
