import { writeFileSync } from "node:fs"
import { resolve } from "node:path"

const markers: Array<{ functionName: string; startPerformanceMs: number; endPerformanceMs: number }> = []

export function bottleneckProfileStartMarker(): { startPerformanceMs: number; endPerformanceMs: number } {
  const startPerformanceMs = performance.now()
  let visits = 0
  while (performance.now() - startPerformanceMs < 50) visits++
  if (visits === 0) throw new Error("Diagnostic start marker did not execute")
  return { startPerformanceMs, endPerformanceMs: performance.now() }
}

export function bottleneckProfileEndMarker(): { startPerformanceMs: number; endPerformanceMs: number } {
  const startPerformanceMs = performance.now()
  let visits = 0
  while (performance.now() - startPerformanceMs < 50) visits++
  if (visits === 0) throw new Error("Diagnostic end marker did not execute")
  return { startPerformanceMs, endPerformanceMs: performance.now() }
}

export function recordBottleneckProfileMarker(functionName: string, bracket: { startPerformanceMs: number; endPerformanceMs: number }): void {
  markers.push({ functionName, ...bracket })
  writeFileSync(resolve(process.env.BOTTLENECK_PROFILE_DIRECTORY!, "profile-clock-markers.json"), JSON.stringify({ pid: process.pid, performanceTimeOriginMs: performance.timeOrigin, markers }))
}
