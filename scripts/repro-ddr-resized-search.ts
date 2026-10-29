import { writeFileSync } from "node:fs"
import { parseArgs } from "node:util"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import { loadA64DdrResizedSearch } from "../tests/fixtures/loadA64DdrResizedSearch"

const { values } = parseArgs({
  options: {
    "max-rss-mib": { type: "string", default: "2048" },
    "max-seconds": { type: "string", default: "90" },
    report: { type: "string" },
  },
})
const maxRssMiB = Number(values["max-rss-mib"])
const maxSeconds = Number(values["max-seconds"])
if (
  !Number.isFinite(maxRssMiB) ||
  maxRssMiB <= 0 ||
  !Number.isFinite(maxSeconds) ||
  maxSeconds <= 0
)
  throw new Error("Reproduction limits must be positive finite numbers")
const params = loadA64DdrResizedSearch()
const solver = new GrowShrinkHighDensityIntraNodeSolver(params)
const started = performance.now()
const observations: unknown[] = []
let nextObservation = 0
let stopReason = "completed"
while (!solver.solved && !solver.failed) {
  solver.step()
  const now = performance.now()
  if (now < nextObservation) continue
  const memory = process.memoryUsage()
  const observation = {
    seconds: (now - started) / 1000,
    iterations: solver.iterations,
    growthAttempts: solver.growthAttempts,
    coordinateScale: solver.scaleFactor,
    memory,
  }
  observations.push(observation)
  console.log(JSON.stringify(observation))
  nextObservation = now + 1000
  if (memory.rss > maxRssMiB * 1024 ** 2) {
    stopReason = "memory_limit"
    break
  }
  if (now - started > maxSeconds * 1000) {
    stopReason = "time_limit"
    break
  }
}
const result = {
  runtime: Bun.version,
  stopReason,
  solved: solver.solved,
  failed: solver.failed,
  error: solver.error,
  seconds: (performance.now() - started) / 1000,
  iterations: solver.iterations,
  peakRssBytes: process.resourceUsage().maxRSS * 1024,
  routeCount: solver.solvedRoutes.length,
  observations,
}
if (values.report) writeFileSync(values.report, JSON.stringify(result, null, 2))
console.log(JSON.stringify(result))
if (stopReason !== "completed") process.exitCode = 2
