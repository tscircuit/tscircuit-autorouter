import { createHash } from "node:crypto"
import { writeFileSync } from "node:fs"
import { loadScenarioBySampleNumber } from "./scenarios"
import { runTask } from "./benchmark-run-task"
import { TraceContactGuard } from "high-density-repair03"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
const loadedAtMs = process.uptime() * 1000
const memoryStages: Array<Record<string, unknown>> = []
const guardMemory: Array<Record<string, unknown>> = []
if (process.env.PROBE_MEMORY === "1") {
  const prototype = AutoroutingPipelineSolver9_PreloadedTraceGraph.prototype
  const originalStep = prototype.step
  prototype.step = function (): void {
    const index = this.currentPipelineStepIndex
    const phase = this.pipelineDef[index]?.solverName
    originalStep.call(this)
    if (index !== this.currentPipelineStepIndex || this.solved || this.failed) {
      memoryStages.push({ phase, ...process.memoryUsage(), peakRssBytes: process.resourceUsage().maxRSS * 1024 })
    }
  }
}
const guardProfile: Record<string, {calls: number; ms: number}> = {}
if (process.env.PROBE_PROFILE === "1") {
  const prototype = TraceContactGuard.prototype as any
  for (const name of Object.getOwnPropertyNames(prototype)) {
    if (name === "constructor" || typeof prototype[name] !== "function") continue
    const original = prototype[name]
    prototype[name] = function (...args: unknown[]) {
      const memoryBefore = process.env.PROBE_MEMORY === "1" && name === "collectContacts"
        ? { ...process.memoryUsage(), peakRssBytes: process.resourceUsage().maxRSS * 1024 }
        : undefined
      const start = performance.now()
      const result = original.apply(this, args)
      if (memoryBefore) {
        guardMemory.push({ method: name, before: memoryBefore, after: { ...process.memoryUsage(), peakRssBytes: process.resourceUsage().maxRSS * 1024 } })
      }
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


const dataset = process.env.PROBE_DATASET!
const sample = Number(process.env.PROBE_SAMPLE)
const { scenario } = await loadScenarioBySampleNumber(dataset, sample)
const started = performance.now()
let progressPeakRssBytes = 0
const result = await runTask({datasetName: dataset, solverName: "AutoroutingPipelineSolver9_PreloadedTraceGraph", scenarioName: `sample${sample}`, sampleNumber: sample, scenario: {...scenario, effort: 1} as any, threads: 1}, {onProgress: () => {progressPeakRssBytes = process.resourceUsage().maxRSS * 1024}})
const {benchmarkSnapshot, ...metrics} = result
const report = {dataset, sample, loadedAtMs, totalTaskMs: performance.now()-started, routingMs: result.elapsedTimeMs, guardProfile, memoryStages, guardMemory, progressPeakRssBytes, peakRssBytes: process.resourceUsage().maxRSS*1024, cpu: process.resourceUsage(), outputHash: createHash("sha256").update(benchmarkSnapshot?.imageSvg ?? "").digest("hex"), metrics}
writeFileSync(process.argv[2]!, JSON.stringify(report, null, 2))
console.log(JSON.stringify({routingMs: report.routingMs, loadedAtMs, peakRssBytes:report.peakRssBytes}))
