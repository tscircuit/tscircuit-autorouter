import { createHash } from "node:crypto"
import { writeFileSync } from "node:fs"
import { loadScenarioBySampleNumber } from "./scenarios"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "../../lib/testing/evaluate-relaxed-drc"

import { TraceContactGuard } from "high-density-repair03"

const guardProfile: Record<string, {calls: number; ms: number}> = {}
if (process.env.PROBE_PROFILE === "1") {
  const prototype = TraceContactGuard.prototype as any
  for (const name of Object.getOwnPropertyNames(prototype)) {
    if (name === "constructor" || typeof prototype[name] !== "function") continue
    const original = prototype[name]
    prototype[name] = function (...args: unknown[]) {
      const start = performance.now()
      const result = original.apply(this, args)
      const row = guardProfile[name] ??= { calls: 0, ms: 0 }
      row.calls++; row.ms += performance.now() - start
      if (name !== "prepareCandidateCheck") return result
      return (...candidateArgs: unknown[]) => {
        const start = performance.now()
        const contacts = result(...candidateArgs)
        const row = guardProfile.candidateCheck ??= { calls: 0, ms: 0 }
        row.calls++; row.ms += performance.now() - start
        return contacts
      }
    }
  }
}

const dataset = process.env.PROBE_DATASET ?? "srj18"
const sample = Number(process.env.PROBE_SAMPLE ?? 15)
const { scenario } = await loadScenarioBySampleNumber(dataset, sample)
const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(
  structuredClone(scenario),
  { cacheProvider: null, effort: 1 },
)
const stages: Array<Record<string, unknown>> = []
const started = performance.now()
let previousBoundary = started
while (!solver.solved && !solver.failed) {
  const index = solver.currentPipelineStepIndex
  const phase = solver.pipelineDef[index]?.solverName ?? "finished"
  solver.step()
  if (solver.currentPipelineStepIndex !== index || solver.solved || solver.failed) {
    const now = performance.now()
    const memory = process.memoryUsage()
    stages.push({
      phase,
      elapsedMs: now - started,
      stageMs: now - previousBoundary,
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      peakRssBytes: process.resourceUsage().maxRSS * (process.platform === "darwin" ? 1 : 1024),
    })
    previousBoundary = now
    console.error(JSON.stringify(stages.at(-1)))
  }
}
const routingMs = performance.now() - started
const routedTraces = solver.solved ? solver.getOutputSimplifiedPcbTraces() : []
const drc = solver.solved ? evaluateRelaxedDrc({
  inputSrj: scenario,
  srjWithPointPairs: solver.srjWithPointPairs!,
  routedTraces,
}) : undefined
const report = {
  dataset, sample, bun: Bun.version, guardProfile,
  contactStats: solver.pipeline9JointDrcRepairSolver?.traceContactRepairSolver?.stats ?? null,
  solved: solver.solved, failed: solver.failed, error: solver.error, routingMs,
  jointStats: solver.pipeline9JointDrcRepairSolver?.stats ?? null,
  jointCache: (() => {
    const cache = (solver.pipeline9JointDrcRepairSolver as any)?.indexedDrcCandidateCache as Map<string, unknown> | undefined
    if (!cache) return null
    return { entries: cache.size, keyCharacters: [...cache.keys()].reduce((sum, key) => sum + key.length, 0) }
  })(),
  peakRssBytes: process.resourceUsage().maxRSS * (process.platform === "darwin" ? 1 : 1024),
  drc: drc?.errors.length ?? null,
  vias: routedTraces.reduce((sum, trace) => sum + trace.route.filter(point => point.route_type === "via").length, 0),
  outputHash: createHash("sha256").update(JSON.stringify(routedTraces)).digest("hex"),
  inputHash: createHash("sha256").update(JSON.stringify(scenario)).digest("hex"),
  phaseTimeSpent: solver.timeSpentOnPhase,
  stages,
}
writeFileSync(process.argv[2]!, JSON.stringify(report, null, 2))
console.log(JSON.stringify({routingMs, peakRssBytes: report.peakRssBytes, drc: report.drc, vias: report.vias}))
