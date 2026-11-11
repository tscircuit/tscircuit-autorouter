import * as os from "node:os"
import { readFileSync } from "node:fs"
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

export const getBenchmarkCpuModel = (
  models: string[],
  cpuInfo: string,
): string => {
  const fields = new Map<string, string>()
  for (const line of cpuInfo.split("\n")) {
    const separator = line.indexOf(":")
    if (separator < 0) continue
    const key = line.slice(0, separator).trim()
    if (!fields.has(key)) fields.set(key, line.slice(separator + 1).trim())
  }
  // Bun reports "unknown" for these ARM CPUs. Linux exposes the actual core
  // identity even when the provider gives different generations one runner tag.
  if (fields.has("CPU implementer") && fields.has("CPU part")) {
    return [
      "CPU implementer",
      "CPU architecture",
      "CPU part",
      "CPU variant",
      "CPU revision",
    ]
      .filter((key) => fields.has(key))
      .map((key) => `${key}=${fields.get(key)}`)
      .join("; ")
  }
  const model = models.find(
    (value) => value.trim() && value.trim().toLowerCase() !== "unknown",
  )
  return model?.trim() || fields.get("model name") || "unknown"
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
    cpuModel: getBenchmarkCpuModel(
      cpus.map((cpu) => cpu.model),
      process.platform === "linux" ? readFileSync("/proc/cpuinfo", "utf8") : "",
    ),
    logicalCpuCount: cpus.length,
    availableParallelism: os.availableParallelism(),
    memoryLimitBytes: getBenchmarkMemoryLimit(),
    memoryBudgetPerWorkerBytes: BENCHMARK_MEMORY_BUDGET_PER_WORKER_BYTES,
    requestedConcurrency,
    workerCount,
  }
}
