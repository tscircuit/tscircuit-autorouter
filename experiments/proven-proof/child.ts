import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

type ProofTask = {
  repo: string
  arm: string
  sourceSha: string
  mode: "performance" | "correctness"
  dataset: string
  sample: number
  effort: number
  resultPath: string
  progressPath: string
  inputPath: string
  inputSha256: string
  scenarioName: string
  totalSamples: number
  hashAfterPerformance: boolean
}

const task = JSON.parse(readFileSync(process.argv[2]!, "utf8")) as ProofTask
const load = async (path: string): Promise<any> =>
  import(pathToFileURL(resolve(task.repo, path)).href)
const sha = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex")
const rss = (): number => process.resourceUsage().maxRSS * 1024
let phase = "loading"
let solver: any
const progress = (nextPhase: string): void => {
  phase = nextPhase
  writeFileSync(task.progressPath, JSON.stringify({
    phase,
    atMs: Date.now(),
    peakRssBytes: rss(),
    activeStage: solver?.pipelineDef[solver.currentPipelineStepIndex]?.solverName,
    iterations: solver?.iterations,
  }))
}

progress("loading")
const { AutoroutingPipelineSolver9_PreloadedTraceGraph: Pipeline } = await load(
  "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph.ts",
)
const { evaluateRelaxedDrc } = await load("lib/testing/evaluate-relaxed-drc.ts")
const { runTraceLinting } = await load("lib/testing/runTraceLinting.ts")
const { extractBenchmarkStageTiming } = await load("scripts/benchmark/benchmark-stage-timing.ts")
const input = JSON.parse(readFileSync(task.inputPath, "utf8"))
const inputSha256 = task.inputSha256
const peakRssBeforeConstructorBytes = rss()
progress("constructor")
const constructionStart = performance.now()
solver = new Pipeline(input, { effort: task.effort, cacheProvider: null })
const constructorMs = performance.now() - constructionStart
progress("solve")
const timer = setInterval(() => progress(phase), 5000)
const start = performance.now()
let thrownError: string | null = null
try {
  await solver.solveAsync()
} catch (error) {
  thrownError = error instanceof Error ? error.stack ?? error.message : String(error)
}
const solveMs = performance.now() - start
clearInterval(timer)
const peakRssAfterSolveBytes = rss()
const solved = solver.solved === true && solver.failed !== true && thrownError === null
const stageTiming = extractBenchmarkStageTiming(solver, solved ? "complete" : "partial")
progress("validation")
let traces: any[] | null = null
let output: unknown = null
let drcErrorCount: number | null = null
let drcErrorTypes: Record<string, number> | null = null
let boardAwareDrcErrorCount: number | null = null
let traceLintIssueCounts: Record<string, number> | null = null
let relaxedErrors: unknown = null
let boardAwareErrors: unknown = null
let viaCount: number | null = null
let wireCount: number | null = null
if (solved) {
  traces = solver.getOutputSimplifiedPcbTraces() as any[]
  output = solver.getOutputSimpleRouteJson()
  const linter = runTraceLinting(output)
  traceLintIssueCounts = {}
  for (const issue of linter.getOutput()) {
    traceLintIssueCounts[issue.type] = (traceLintIssueCounts[issue.type] ?? 0) + 1
  }
  const drcInput = {
    inputSrj: input,
    srjWithPointPairs: solver.srjWithPointPairs ?? input,
    routedTraces: traces,
  }
  const relaxed = evaluateRelaxedDrc(drcInput)
  relaxedErrors = relaxed.errors
  drcErrorCount = relaxed.errors.length
  drcErrorTypes = {}
  for (const error of relaxed.errors) {
    drcErrorTypes[error.type] = (drcErrorTypes[error.type] ?? 0) + 1
  }
  const sourceOptions: Record<string, number> = {}
  const traceClearance = input.minTraceToPadEdgeClearance ?? input.defaultObstacleMargin
  if (traceClearance !== undefined) sourceOptions.traceClearance = traceClearance
  if (input.minViaHoleEdgeToViaHoleEdgeClearance !== undefined) {
    sourceOptions.viaClearance = input.minViaHoleEdgeToViaHoleEdgeClearance
  }
  const boardAware = evaluateRelaxedDrc({
    ...drcInput,
    includeBoardClearance: true,
    drcOptions: sourceOptions,
  })
  boardAwareErrors = boardAware.errors
  boardAwareDrcErrorCount = boardAware.errors.length
  viaCount = 0
  wireCount = 0
  for (const trace of traces) {
    for (const point of trace.route) {
      if (point.route_type === "via") viaCount++
      if (point.route_type === "wire") wireCount++
    }
  }
}
const peakRssAfterValidationBytes = rss()
// Freeze both memory boundaries before any full-output serialization. The
// correctness processes are separate and their timings/RSS are never pooled.
progress("hash")
const hashes = (task.mode === "correctness" || task.hashAfterPerformance) && solved
  ? {
      tracesSha256: sha(traces),
      outputSha256: sha(output),
      relaxedErrorsSha256: sha(relaxedErrors),
      boardAwareErrorsSha256: sha(boardAwareErrors),
      inputAfterSha256: sha(input),
    }
  : null
const result = {
  schemaVersion: 1,
  arm: task.arm,
  sourceSha: task.sourceSha,
  mode: task.mode,
  dataset: task.dataset,
  sample: task.sample,
  scenarioName: task.scenarioName,
  totalSamples: task.totalSamples,
  effort: task.effort,
  inputSha256,
  status: thrownError ? "exception" : solved ? "solved" : "failed",
  error: thrownError ?? solver.error ?? null,
  constructorMs,
  solveMs,
  peakRssBeforeConstructorBytes,
  peakRssAfterSolveBytes,
  peakRssAfterValidationBytes,
  stageTiming,
  iterations: solver.iterations,
  drcErrorCount,
  drcErrorTypes,
  boardAwareDrcErrorCount,
  traceLintIssueCounts,
  traceCount: traces?.length ?? null,
  viaCount,
  wireCount,
  hashes,
}
writeFileSync(task.resultPath, JSON.stringify(result))
progress("complete")
