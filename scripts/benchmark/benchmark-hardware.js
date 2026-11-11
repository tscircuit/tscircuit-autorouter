// Shared by the Bun benchmark tools and the Node-based PR comment renderer.
export const getBenchmarkHardware = (runtime) => {
  if (
    !runtime ||
    typeof runtime.cpuModel !== "string" ||
    !runtime.cpuModel.trim() ||
    runtime.cpuModel.trim().toLowerCase() === "unknown" ||
    typeof runtime.platform !== "string" ||
    typeof runtime.architecture !== "string" ||
    !runtime.platform.trim() ||
    !runtime.architecture.trim()
  ) {
    return null
  }
  const threads =
    runtime.effectiveThreadsPerSample ?? runtime.threadsPerSample ?? 1
  const counts = [
    runtime.logicalCpuCount,
    runtime.availableParallelism,
    runtime.memoryLimitBytes,
    runtime.workerCount,
    threads,
  ]
  if (counts.some((count) => !Number.isSafeInteger(count) || count < 1)) {
    return null
  }
  const cpuModel = runtime.cpuModel.trim()
  const workerLabel = runtime.workerCount === 1 ? "worker" : "workers"
  const threadLabel = threads === 1 ? "thread/sample" : "threads/sample"
  return {
    key: JSON.stringify([
      runtime.platform,
      runtime.architecture,
      cpuModel,
      ...counts,
    ]),
    label: `${cpuModel} · ${runtime.logicalCpuCount} CPUs · ${runtime.workerCount} ${workerLabel} · ${threads} ${threadLabel}`,
  }
}
