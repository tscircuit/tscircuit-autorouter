import * as os from "node:os"
import type { BenchmarkRuntimeMetadata } from "./benchmark-types"

export const getBenchmarkConcurrency = (): number => {
  // Bun accounts for CPU quota and process affinity in availableParallelism.
  // Use the same value in the shell entrypoint and direct TypeScript runs.
  return os.availableParallelism()
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
    availableParallelism: getBenchmarkConcurrency(),
    requestedConcurrency,
    workerCount,
  }
}
