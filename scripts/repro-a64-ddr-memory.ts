import { createHash } from "node:crypto"
import { writeFileSync } from "node:fs"
import { parseArgs } from "node:util"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { Pipeline9HighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import type { BaseSolver } from "lib/solvers/BaseSolver"
import {
  loadA64DdrHighDensityMemoryParams,
  loadA64FullDdrMemoryInput,
} from "../tests/fixtures/loadA64DdrMemoryFixture"

type RetentionSummary = {
  solverCount: number
  portfolioCandidates: number
  retiredGrowthPortfolios: number
  debugExplorationPoints: number
  retainedFailedRouteSearches: number
  planarPointCacheEntries: number
  typedBufferBytes: number
}

function measureSearchRetention(root: BaseSolver): RetentionSummary {
  const seen = new Set<object>()
  const buffers = new Set<ArrayBufferLike>()
  const result: RetentionSummary = {
    solverCount: 0,
    portfolioCandidates: 0,
    retiredGrowthPortfolios: 0,
    debugExplorationPoints: 0,
    retainedFailedRouteSearches: 0,
    planarPointCacheEntries: 0,
    typedBufferBytes: 0,
  }
  const pending: unknown[] = [root]
  while (pending.length > 0) {
    const value = pending.pop()
    if (value === null || typeof value !== "object" || seen.has(value)) continue
    seen.add(value)
    const solver = value as Record<string, any>
    result.solverCount++
    result.portfolioCandidates += solver.supervisedSolvers?.length ?? 0
    result.debugExplorationPoints +=
      solver.debug_exploredNodesOrdered?.length ?? 0
    result.planarPointCacheEntries += solver.freePlanarObstaclePoints?.size ?? 0
    result.retainedFailedRouteSearches += solver.failedSubSolvers?.length ?? 0
    if (solver.constructor.name === "GrowShrinkHighDensityIntraNodeSolver") {
      result.retiredGrowthPortfolios += solver.failedSolvers.length
    }
    for (const field of Object.values(solver)) {
      if (ArrayBuffer.isView(field) && !buffers.has(field.buffer)) {
        buffers.add(field.buffer)
        result.typedBufferBytes += field.buffer.byteLength
      }
    }
    for (const key of [
      "highDensityRouteSolver",
      "highDensitySolver",
      "activeSubSolver",
      "activeRegularSolver",
      "activeB01Solver",
      "activeFallbackSolver",
      "winningSolver",
      "activeSolver",
    ]) {
      pending.push(solver[key])
    }
    for (const key of [
      "supervisedSolvers",
      "failedSolvers",
      "failedSubSolvers",
    ]) {
      if (Array.isArray(solver[key])) {
        pending.push(...solver[key].map((entry: any) => entry.solver ?? entry))
      }
    }
  }
  return result
}

const { values } = parseArgs({
  options: {
    full: { type: "boolean", default: false },
    "max-steps": { type: "string", default: "100000" },
    "max-rss-mib": { type: "string", default: "4096" },
    "max-seconds": { type: "string", default: "360" },
    report: { type: "string" },
  },
})
const maxSteps = Number(values["max-steps"])
const maxRssMiB = Number(values["max-rss-mib"])
const maxSeconds = Number(values["max-seconds"])
if (
  !Number.isSafeInteger(maxSteps) ||
  maxSteps < 1 ||
  !Number.isFinite(maxRssMiB) ||
  maxRssMiB <= 0 ||
  !Number.isFinite(maxSeconds) ||
  maxSeconds <= 0
) {
  throw new Error("Memory reproduction limits must be positive finite numbers")
}
const solver = values.full
  ? new AutoroutingPipelineSolver9_PreloadedTraceGraph(
      loadA64FullDdrMemoryInput(),
      { effort: 1, cacheProvider: null },
    )
  : new Pipeline9HighDensitySolver(loadA64DdrHighDensityMemoryParams())
const started = performance.now()
let nextObservation = started
let sampledPeakRssBytes = 0
let stopReason = "step_limit"
const observations: unknown[] = []
for (let steps = 0; steps < maxSteps; steps++) {
  if (solver.solved || solver.failed) {
    stopReason = solver.solved ? "solved" : "failed"
    break
  }
  solver.step()
  const now = performance.now()
  if (now >= nextObservation) {
    const memory = process.memoryUsage()
    sampledPeakRssBytes = Math.max(sampledPeakRssBytes, memory.rss)
    const observation = {
      seconds: (now - started) / 1000,
      iterations: solver.iterations,
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      phase:
        solver instanceof AutoroutingPipelineSolver9_PreloadedTraceGraph
          ? solver.getCurrentPhase()
          : "highDensityRouteSolver",
      retention: measureSearchRetention(solver),
    }
    observations.push(observation)
    console.log(JSON.stringify(observation))
    if (memory.rss > maxRssMiB * 1024 ** 2) {
      stopReason = "memory_limit"
      break
    }
    if (now - started >= maxSeconds * 1000) {
      stopReason = "time_limit"
      break
    }
    nextObservation = now + 1000
  }
}
const highDensity =
  solver instanceof Pipeline9HighDensitySolver
    ? solver
    : solver.highDensityRouteSolver
const routes = highDensity?.routes ?? []
const result = {
  runtime: Bun.version,
  fullPipeline: values.full,
  maxSteps,
  maxRssMiB,
  maxSeconds,
  stopReason,
  seconds: (performance.now() - started) / 1000,
  sampledPeakRssBytes,
  processPeakRssBytes: process.resourceUsage().maxRSS * 1024,
  iterations: solver.iterations,
  solved: solver.solved,
  failed: solver.failed,
  error: solver.error,
  localRouteCount: routes.length,
  localRoutesSha256: createHash("sha256")
    .update(JSON.stringify(routes))
    .digest("hex"),
  highDensityStats: highDensity?.stats,
  retention: measureSearchRetention(solver),
  observations,
}
if (values.report) writeFileSync(values.report, JSON.stringify(result, null, 2))
console.log(JSON.stringify(result))
if (stopReason === "memory_limit" || stopReason === "time_limit")
  process.exitCode = 2
