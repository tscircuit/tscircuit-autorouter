import { strict as assert } from "node:assert"
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { applyControls, controls, decodeParams, encodeParams, jsonSha, observeLargestA01, occupancyDiagnostics, publicState, publicTrajectory, replayFingerprint, setupState } from "./component-state"

const task: any = JSON.parse(readFileSync(process.argv[2]!, "utf8"))
const fileSha = (path: string): string => { const bytes = readFileSync(path); return createHash("sha256").update(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)).digest("hex") }
const nativeRss = (): number => process.resourceUsage().maxRSS * 1024
async function loadA01(repo: string): Promise<any> {
  const entry = Bun.resolveSync("@tscircuit/high-density-a01", repo)
  return import(pathToFileURL(entry).href)
}

async function capturePipeline(): Promise<void> {
const load = async (path: string): Promise<any> =>
  import(pathToFileURL(resolve(task.repo, path)).href)
const sha = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex")
const rss = (): number => process.resourceUsage().maxRSS * 1024
let phase = "loading"
let solver: any
let measurements: Record<string, unknown> = {}
const progress = (nextPhase: string): void => {
  phase = nextPhase
  writeFileSync(task.progressPath, JSON.stringify({
    phase,
    atMs: Date.now(),
    peakRssBytes: rss(),
    activeStage: solver?.pipelineDef[solver.currentPipelineStepIndex]?.solverName,
    iterations: solver?.iterations,
    measurements,
  }))
}

progress("loading")
const { AutoroutingPipelineSolver9_PreloadedTraceGraph: Pipeline } = await load(
  "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph.ts",
)
const { evaluateRelaxedDrc } = await load("lib/testing/evaluate-relaxed-drc.ts")
const { runTraceLinting } = await load("lib/testing/runTraceLinting.ts")
const { extractBenchmarkStageTiming } = await load("scripts/benchmark/benchmark-stage-timing.ts")
const { HighDensitySolverA01 } = await loadA01(task.repo)
const observer = observeLargestA01(HighDensitySolverA01)
const input = JSON.parse(readFileSync(task.inputPath, "utf8"))
const inputSha256 = task.inputSha256
const peakRssBeforeConstructorBytes = rss()
progress("constructor")
const constructionStart = performance.now()
const options = task.cacheMode === "production-default"
  ? { effort: task.effort }
  : { effort: task.effort, cacheProvider: null }
solver = new Pipeline(input, options)
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
measurements = {
  constructorMs,
  solveMs,
  routingMs: constructorMs + solveMs,
  peakRssBeforeConstructorBytes,
  peakRssAfterSolveBytes,
  routingCompleted: solved,
  sourceSolveError: thrownError ?? solver.error ?? null,
}
const stageTiming = extractBenchmarkStageTiming(solver, solved ? "complete" : "partial")
progress("validation")
const validationStart = performance.now()
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
const validationMs = performance.now() - validationStart
measurements = {
  ...measurements,
  validationMs,
  peakRssAfterValidationBytes,
  drcErrorCount,
  boardAwareDrcErrorCount,
  traceCount: traces?.length ?? null,
  viaCount,
  wireCount,
}
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
  cacheMode: task.cacheMode,
  bunVersion: Bun.version,
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
  routingMs: constructorMs + solveMs,
  validationMs,
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
  jointDrcCacheDiagnostics: solver.pipeline9JointDrcRepairSolver
    ? {
        referenceValidationCount:
          solver.pipeline9JointDrcRepairSolver.referenceDrcValidationCount,
        referenceFalseNegativeCount:
          solver.pipeline9JointDrcRepairSolver.referenceDrcFalseNegativeCount,
        indexedCacheHitCount:
          solver.pipeline9JointDrcRepairSolver.indexedDrcCacheHitCount,
      }
    : null,
}
const capture = observer.finish()
observer.restore()
writeFileSync(task.componentCapturePath, JSON.stringify(capture))
Object.assign(result, { componentCaptureSha256: fileSha(task.componentCapturePath), captureQualification: capture.qualification, timingQualification: "Instrumented full-pipeline functional diagnostic only; its runtime/RSS are never performance gain evidence." })
writeFileSync(task.resultPath, JSON.stringify(result))
progress("complete")

}

function reportProgress(phase: string, measurements: Record<string, unknown> = {}): void {
  writeFileSync(task.progressPath, JSON.stringify({ phase, atMs: Date.now(), measurements }))
}

function validateCapture(capture: any): void {
  assert.equal(capture.schemaVersion, 1)
  assert.equal(capture.selection.concreteClass, "HighDensitySolverA01")
  assert(Array.isArray(capture.steps) && capture.steps.length > 0)
  let calls = 0
  for (const segment of capture.steps) {
    assert(Number.isSafeInteger(segment.count) && segment.count > 0)
    assert.deepEqual(Object.keys(segment.beforeControls), ["MAX_ITERATIONS", "MAX_RIPS", "stepMultiplier"])
    calls += segment.count
  }
  assert(Number.isSafeInteger(calls) && calls === capture.totalStepCalls)
  assert.equal(jsonSha(capture.steps), capture.expectedPublicReplay.referenceSequenceSha256)
  assert.equal(capture.publicTrajectorySha256, capture.expectedPublicReplay.captureObservedScalarTrajectorySha256)
  assert.equal(capture.totalStepCalls, capture.expectedPublicReplay.totalStepCalls)
  assert.deepEqual(encodeParams(decodeParams(capture.params)), capture.params)
}

function replayCalls(solver: any, capture: any, observe: boolean): string | null {
  const trajectory = observe ? publicTrajectory() : null
  for (const segment of capture.steps) {
    applyControls(solver, segment.beforeControls)
    for (let i = 0; i < segment.count; i++) {
      if (trajectory === null) {
        // Measured path: exact known controls/calls, no quality observer, output
        // serialization, page counters or array walks before native boundaries.
        solver.step()
      } else {
        const before = publicState(solver)
        const returned = solver.step()
        assert.equal(returned, undefined)
        trajectory.append(before, publicState(solver))
      }
    }
  }
  return trajectory === null ? null : trajectory.finish()
}

function publicReplay(solver: any, capture: any): any {
  return { setupPublicState: capture.setup.publicStateAfterSetup, terminalPublicState: publicState(solver), outputSha256: jsonSha(solver.getOutput()), referenceSequenceSha256: jsonSha(capture.steps), captureObservedScalarTrajectorySha256: capture.publicTrajectorySha256, totalStepCalls: capture.totalStepCalls }
}

function setupSolver(A01: any, args: any[], capture: any): any {
  const solver = new A01(...args)
  applyControls(solver, capture.setup.beforeControls)
  solver.setup()
  assert.deepEqual(controls(solver), capture.setup.afterControls)
  assert.deepEqual(setupState(solver), capture.setup.publicStateAfterSetup)
  return solver
}

async function component(): Promise<void> {
  assert(task.mode === "verify" || task.mode === "replay")
  assert.equal(task.cacheMode, "production-default")
  assert.equal(task.effort, 1)
  reportProgress("loading")
  const { HighDensitySolverA01: A01 } = await loadA01(task.repo)
  assert.equal(fileSha(task.componentCapturePath), task.componentCaptureSha256)
  const capture = JSON.parse(readFileSync(task.componentCapturePath, "utf8"))
  validateCapture(capture)
  const args = decodeParams(capture.params)
  assert(Array.isArray(args) && args.length === 1)
  const common = { schemaVersion: 1, mode: task.mode, arm: task.arm, sourceSha: task.sourceSha, cacheMode: task.cacheMode, bunVersion: Bun.version, dataset: task.dataset, sample: task.sample, effort: task.effort, inputSha256: task.inputSha256, inputCaptureSha256: task.componentCaptureSha256 }
  if (task.mode === "verify") {
    assert.equal(task.arm, "base", "Only actual stock may establish verification expectations")
    reportProgress("verify")
    const solver = setupSolver(A01, args, capture)
    const setupStateSha256 = jsonSha(replayFingerprint(solver, capture))
    const observedScalarTrajectorySha256 = replayCalls(solver, capture, true)
    assert.equal(observedScalarTrajectorySha256, capture.publicTrajectorySha256)
    const publicReplayFingerprint = publicReplay(solver, capture)
    assert.deepEqual(publicReplayFingerprint, capture.expectedPublicReplay)
    const expectedReplayFingerprint = { ...replayFingerprint(solver, capture), setupStateSha256 }
    const verified = { schemaVersion: 1, componentCaptureSha256: task.componentCaptureSha256, sourceSha: task.sourceSha, expectedPublicReplay: publicReplayFingerprint, expectedReplayFingerprint, observedScalarTrajectorySha256, qualification: "UNMEASURED stock verification only. Every captured public scalar step and the terminal route output match the actual baseline pipeline capture. Full terminal private and full setup state are streamed here, never inferred from pipeline per-frame private snapshots." }
    writeFileSync(task.componentVerifiedPath, JSON.stringify(verified))
    writeFileSync(task.resultPath, JSON.stringify({ ...common, status: "verified", publicReplayFingerprint, replayFingerprint: expectedReplayFingerprint, componentVerifiedSha256: fileSha(task.componentVerifiedPath), observedScalarTrajectorySha256, measurementRole: "unmeasured-stock-functional-verification" }))
    reportProgress("complete")
    return
  }
  assert.equal(fileSha(task.componentVerifiedPath), task.componentVerifiedSha256)
  const verified = JSON.parse(readFileSync(task.componentVerifiedPath, "utf8"))
  assert.equal(verified.schemaVersion, 1)
  assert.equal(verified.componentCaptureSha256, task.componentCaptureSha256)
  assert.deepEqual(verified.expectedPublicReplay, capture.expectedPublicReplay)
  reportProgress("constructor")
  const peakRssBeforeConstructorBytes = nativeRss()
  const constructorStart = performance.now()
  let solver: any = new A01(...args)
  const constructorMs = performance.now() - constructorStart
  const peakRssAfterConstructorBytes = nativeRss()
  reportProgress("setup")
  const setupStart = performance.now()
  applyControls(solver, capture.setup.beforeControls)
  solver.setup()
  const setupMs = performance.now() - setupStart
  const peakRssAfterSetupBytes = nativeRss()
  reportProgress("replay", { constructorMs, setupMs, peakRssBeforeConstructorBytes, peakRssAfterConstructorBytes, peakRssAfterSetupBytes })
  const replayStart = performance.now()
  replayCalls(solver, capture, false)
  const replayMs = performance.now() - replayStart
  const peakRssAfterReplayBytes = nativeRss()
  const metrics = { constructorMs, setupMs, replayMs, totalReplayMs: constructorMs + setupMs + replayMs, peakRssBeforeConstructorBytes, peakRssAfterConstructorBytes, peakRssAfterSetupBytes, peakRssAfterReplayBytes }
  // Every native/time boundary is frozen. Everything below is post-metric
  // verification/diagnostics and cannot change the reported high-water marks.
  reportProgress("diagnostics", metrics)
  const publicReplayFingerprint = publicReplay(solver, capture)
  assert.deepEqual(publicReplayFingerprint, verified.expectedPublicReplay)
  const fingerprint = replayFingerprint(solver, capture)
  const occupancyAtEnd = { diagnosticOrigin: "measuredInstanceAfterFrozenMetrics", ...occupancyDiagnostics(solver) }
  assert.equal(jsonSha(encodeParams(args)), jsonSha(capture.params), "Standalone solve mutated constructor input")
  solver = null
  const setupOnly = setupSolver(A01, decodeParams(capture.params), capture)
  const setupStateSha256 = jsonSha(replayFingerprint(setupOnly, capture))
  const occupancyAtSetup = { diagnosticOrigin: "postMetricSetupReconstruction", ...occupancyDiagnostics(setupOnly) }
  const replayFingerprintResult = { ...fingerprint, setupStateSha256 }
  assert.deepEqual(replayFingerprintResult, verified.expectedReplayFingerprint)
  assert.equal(fileSha(task.componentCapturePath), task.componentCaptureSha256)
  assert.equal(fileSha(task.componentVerifiedPath), task.componentVerifiedSha256)
  writeFileSync(task.resultPath, JSON.stringify({ ...common, status: "replayed", ...metrics, componentStatus: publicReplayFingerprint.terminalPublicState.solved ? "solved" : publicReplayFingerprint.terminalPublicState.failed ? "failed" : "unfinished", error: publicReplayFingerprint.terminalPublicState.error, iterations: publicReplayFingerprint.terminalPublicState.iterations, publicReplayFingerprint, replayFingerprint: replayFingerprintResult, occupancyAtSetup, occupancyAtEnd, unmeasuredStockVerificationSha256: task.componentVerifiedSha256, publicTrajectoryObservation: "baseline-capture-and-unmeasured-stock-verification-only; measuredpassdoesnotobserveeachframe", memoryQualification: "Unsubtracted native process maxRSS; payload/page counts are separate post-metric diagnostics, not RSS or a cumulative peak." }))
  reportProgress("complete", metrics)
}

if (task.mode === "capture") await capturePipeline()
else await component()
