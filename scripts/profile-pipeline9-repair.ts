import { mkdirSync, writeFileSync } from "node:fs"
import { GlobalDrcBranchPortfolioSolver } from "high-density-repair03"
import { createSolverForTask } from "./benchmark/benchmark-run-task"
import { loadScenarioBySampleNumber } from "./benchmark/scenarios"
import { evaluateRelaxedDrc } from "../lib/testing/evaluate-relaxed-drc"

type BranchTiming = { calls: number; elapsedTimeMs: number }
type ObservedSolver = {
  getSolverName?: () => string
  iterations?: number
  solved?: boolean
  failed?: boolean
  phase?: string
  stats?: Record<string, unknown>
  activeSubSolver?: ObservedSolver | null
}
type ProgressSample = {
  elapsedTimeMs: number
  phaseName: string | undefined
  chain: Array<{
    name: string
    iterations: number | undefined
    phase: string | undefined
    solved: boolean | undefined
  }>
}

// Diagnostic instrumentation only: the original step and return value are
// preserved. CPU sampling supplies function-level evidence independently.
const branchTimings: Record<string, BranchTiming> = {}
const originalPortfolioStep = GlobalDrcBranchPortfolioSolver.prototype.step
GlobalDrcBranchPortfolioSolver.prototype.step = function (): void {
  const phase: unknown = Reflect.get(this, "phase")
  if (typeof phase !== "string") {
    throw new Error("Repair03 portfolio did not expose its phase")
  }
  const startedAt = performance.now()
  try {
    return originalPortfolioStep.call(this)
  } finally {
    const timing = (branchTimings[phase] ??= { calls: 0, elapsedTimeMs: 0 })
    timing.calls += 1
    timing.elapsedTimeMs += performance.now() - startedAt
  }
}

const getActiveChain = (root: ObservedSolver): ProgressSample["chain"] => {
  const chain: ProgressSample["chain"] = []
  const seen = new Set<ObservedSolver>()
  let current: ObservedSolver | null | undefined = root
  while (current) {
    if (seen.has(current)) throw new Error("Cyclic active solver chain")
    seen.add(current)
    chain.push({
      name: current.getSolverName?.() ?? current.constructor.name,
      iterations: current.iterations,
      phase: current.phase,
      solved: current.solved,
    })
    current = current.activeSubSolver
  }
  return chain
}

const sampleNumber = Number(process.argv[2])
const outputDirectory = process.argv[3]
if (!Number.isInteger(sampleNumber) || sampleNumber < 1 || !outputDirectory) {
  throw new Error("Usage: profile-pipeline9-repair.ts SAMPLE OUTPUT_DIRECTORY")
}
mkdirSync(outputDirectory, { recursive: true })
const { scenario, scenarioName } = await loadScenarioBySampleNumber(
  "srj18",
  sampleNumber,
)
const inputJson = JSON.stringify(scenario)
writeFileSync(`${outputDirectory}/input.json`, inputJson)
const solver = createSolverForTask({
  datasetName: "srj18",
  solverName: "AutoroutingPipelineSolver9_PreloadedTraceGraph",
  scenarioName,
  sampleNumber,
  scenario,
})
if (typeof solver.step !== "function") {
  throw new Error("Pipeline 9 must support step() for this diagnostic")
}

const progressSamples: ProgressSample[] = []
const startedAt = performance.now()
const diagnosticBudgetMs = 360_000
let didTimeout = false
let failure: string | null = null
let lastProgressAt = -Infinity
let lastPhase: string | undefined
let jointSolver: ObservedSolver | undefined
let iteration = 0
let observedPipelineStepIndex = -1

const getJointCounters = (): Record<string, unknown> => {
  const counters: Record<string, unknown> = {}
  if (!jointSolver) return counters
  for (const name of [
    "referenceDrcValidationCount",
    "referenceDrcFalseNegativeCount",
    "indexedDrcEvaluationCount",
    "indexedDrcCacheHitCount",
    "indexedDrcEvaluationTimeMs",
  ]) {
    counters[name] = Reflect.get(jointSolver, name)
  }
  return counters
}

const captureProgress = (): void => {
  observedPipelineStepIndex = solver.currentPipelineStepIndex
  const phaseName = solver.pipelineDef[solver.currentPipelineStepIndex]?.solverName
  const elapsedTimeMs = performance.now() - startedAt
  if (solver.pipeline9JointDrcRepairSolver) {
    jointSolver = solver.pipeline9JointDrcRepairSolver as ObservedSolver
  }
  if (phaseName !== lastPhase || elapsedTimeMs - lastProgressAt >= 3_000) {
    const progress: ProgressSample = {
      elapsedTimeMs,
      phaseName,
      chain: getActiveChain(solver as ObservedSolver),
    }
    progressSamples.push(progress)
    console.log(JSON.stringify(progress))
    lastPhase = phaseName
    lastProgressAt = elapsedTimeMs
    writeFileSync(
      `${outputDirectory}/progress.json`,
      JSON.stringify({ progressSamples, branchTimings, jointStats: jointSolver?.stats, jointCounters: getJointCounters() }),
    )
  }
}

try {
  captureProgress()
  while (!solver.solved && !solver.failed) {
    solver.step()
    iteration += 1
    // Keep observation overhead away from individual high-density iterations.
    // Once joint repair starts, its much coarser steps are observed individually.
    if (
      iteration % 512 === 0 ||
      jointSolver ||
      solver.pipelineDef[solver.currentPipelineStepIndex]?.solverName ===
        "pipeline9JointDrcRepairSolver" ||
      solver.currentPipelineStepIndex !== observedPipelineStepIndex
    ) {
      captureProgress()
      if (performance.now() - startedAt >= diagnosticBudgetMs) {
        didTimeout = true
        break
      }
    }
  }
} catch (error) {
  failure = error instanceof Error ? error.stack ?? error.message : String(error)
}
captureProgress()
const elapsedTimeMs = performance.now() - startedAt
const didSolve = Boolean(solver.solved && !solver.failed && !failure && !didTimeout)
let drcCount: number | null = null
let traceCount: number | null = null
let viaCount: number | null = null
if (didSolve) {
  if (!jointSolver) {
    throw new Error("Completed solve is missing observed joint repair")
  }
  if (!solver.getOutputSimplifiedPcbTraces || !solver.srjWithPointPairs) {
    throw new Error("Solved Pipeline 9 is missing output or point-pair SRJ")
  }
  const traces = solver.getOutputSimplifiedPcbTraces()
  const { errors } = evaluateRelaxedDrc({
    inputSrj: scenario,
    srjWithPointPairs: solver.srjWithPointPairs,
    routedTraces: traces,
  })
  drcCount = errors.length
  traceCount = traces.length
  viaCount = traces.reduce(
    (count, trace) => count + trace.route.filter((point) => point.route_type === "via").length,
    0,
  )
  writeFileSync(`${outputDirectory}/routes.json`, JSON.stringify(traces))
  writeFileSync(`${outputDirectory}/drc-errors.json`, JSON.stringify(errors))
}
const summary = {
  sampleNumber,
  scenarioName,
  bunVersion: Bun.version,
  inputSha256: new Bun.CryptoHasher("sha256").update(inputJson).digest("hex"),
  diagnosticBudgetMs,
  didSolve,
  didTimeout,
  failure: failure ?? solver.error ?? null,
  elapsedTimeMs,
  traceCount,
  viaCount,
  drcCount,
  pipelineIterations: solver.iterations,
  highDensityIterations: solver.highDensityRouteSolver?.iterations,
  phaseTimeMs: solver.timeSpentOnPhase,
  branchTimings,
  jointStats: jointSolver?.stats,
  jointCounters: getJointCounters(),
  progressSamples,
}
writeFileSync(`${outputDirectory}/summary.json`, JSON.stringify(summary, null, 2))
console.log(JSON.stringify(summary))
if (!didSolve) process.exitCode = didTimeout ? 2 : 1
