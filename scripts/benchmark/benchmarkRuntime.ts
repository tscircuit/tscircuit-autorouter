import * as os from "node:os"
import type { BenchmarkRuntimeMetadata } from "./benchmark-types"

// Dataset 18 processes have measured peaks near 6 GiB. Leave room for each
// solver's heap and background GC instead of filling every CPU with a board.
export const BENCHMARK_MEMORY_BUDGET_PER_WORKER_BYTES = 6 * 1024 ** 3

export const getBenchmarkMemoryLimit = (): number => {
  const hostMemory = os.totalmem()
  const constrainedMemory = process.constrainedMemory?.()
  if (typeof constrainedMemory === "number" && constrainedMemory > 0) {
    return Math.min(hostMemory, constrainedMemory)
  }
  return hostMemory
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

/** One coordinator plus N routing workers; a single-thread run stays inline. */
export const getBenchmarkThreadConcurrency = (
  requestedConcurrency: number,
  threads: number,
  availableParallelism = os.availableParallelism(),
  memoryLimitBytes = getBenchmarkMemoryLimit(),
): number => {
  if (!Number.isSafeInteger(threads) || threads < 1) {
    throw new Error("--threads must be a positive integer")
  }
  if (!Number.isSafeInteger(requestedConcurrency) || requestedConcurrency < 1) {
    throw new Error("--concurrency must be a positive integer")
  }
  const cpuBudgetPerSample = threads === 1 ? 1 : threads + 1
  const cpuSampleLimit = Math.floor(availableParallelism / cpuBudgetPerSample)
  const memorySampleLimit = Math.floor(
    memoryLimitBytes / BENCHMARK_MEMORY_BUDGET_PER_WORKER_BYTES,
  )
  return Math.max(
    1,
    Math.min(requestedConcurrency, cpuSampleLimit, memorySampleLimit),
  )
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
