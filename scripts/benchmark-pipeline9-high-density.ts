import { createHash } from "node:crypto"
import { mkdir, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { dataset } from "dataset-srj18"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "../lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "../lib/types"

type StageDuration = { stage: string; durationMs: number }

const sampleId = `sample${String(Number(process.argv[2])).padStart(3, "0")}`
const entry = Object.entries(dataset).find(([key]) => key === sampleId)
if (!entry) throw new Error(`Unknown sample ${sampleId}`)
const inputSrj = structuredClone(entry[1]) as SimpleRouteJson
const inputSha256 = createHash("sha256")
  .update(JSON.stringify(inputSrj))
  .digest("hex")
const outFile = process.argv[3]
if (!outFile)
  throw new Error(
    "Usage: bun scripts/benchmark-pipeline9-high-density.ts <sample number> <report path>",
  )
const stages: StageDuration[] = []
const startedAt = new Date().toISOString()
const cpuStart = process.cpuUsage()
const startMs = performance.now()
const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(inputSrj, {
  effort: 1,
})
const constructionDurationMs = performance.now() - startMs
let thrownError: string | null = null
try {
  while (!solver.solved && !solver.failed) {
    const stageIndex = solver.currentPipelineStepIndex
    const stage =
      solver.pipelineDef[stageIndex]?.solverName ?? "pipeline_completion"
    const stageStartMs = performance.now()
    try {
      do {
        solver.step()
      } while (
        !solver.solved &&
        !solver.failed &&
        solver.currentPipelineStepIndex === stageIndex
      )
    } finally {
      stages.push({ stage, durationMs: performance.now() - stageStartMs })
    }
  }
} catch (error) {
  thrownError = String(error)
}
const durationMs = performance.now() - startMs
const cpuUsage = process.cpuUsage(cpuStart)
const outputSrj = solver.solved ? solver.getOutputSimpleRouteJson() : null
const drc = solver.solved
  ? evaluateRelaxedDrc({
      inputSrj,
      srjWithPointPairs: solver.srjWithPointPairs ?? inputSrj,
      routedTraces: solver.getOutputSimplifiedPcbTraces(),
    })
  : null
const report = {
  sampleId,
  startedAt,
  completedAt: new Date().toISOString(),
  effort: 1,
  bun: Bun.version,
  bunRevision: Bun.revision,
  revision: Bun.spawnSync(["git", "rev-parse", "HEAD"])
    .stdout.toString()
    .trim(),
  inputSha256,
  outputSha256: outputSrj
    ? createHash("sha256").update(JSON.stringify(outputSrj)).digest("hex")
    : null,
  solved: solver.solved,
  failed: solver.failed,
  error: thrownError ?? solver.error,
  durationMs,
  constructionDurationMs,
  stages,
  iterations: solver.iterations,
  cpuUserMs: cpuUsage.user / 1000,
  cpuSystemMs: cpuUsage.system / 1000,
  peakRssBytes:
    process.resourceUsage().maxRSS * (process.platform === "darwin" ? 1 : 1024),
  relaxedDrcErrors: drc?.errors ?? null,
  vias:
    outputSrj?.traces?.reduce(
      (sum, trace) =>
        sum + trace.route.filter((point) => point.route_type === "via").length,
      0,
    ) ?? null,
  highDensityStats: solver.highDensityRouteSolver?.stats ?? null,
}
await mkdir(dirname(outFile), { recursive: true })
await writeFile(outFile, JSON.stringify(report, null, 2))
if (outputSrj)
  await writeFile(
    `${outFile}.output.json.gz`,
    Bun.gzipSync(JSON.stringify(outputSrj)),
  )
console.log(
  `${sampleId} solved=${solver.solved} failed=${solver.failed} duration=${(durationMs / 1000).toFixed(3)}s hd=${((stages.find((stage) => stage.stage === "highDensityRouteSolver")?.durationMs ?? 0) / 1000).toFixed(3)}s drc=${drc?.errors.length ?? "not_run"}`,
)
