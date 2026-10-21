import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { gzipSync } from "node:zlib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "../../lib/testing/evaluate-relaxed-drc"
import type { BaseSolver } from "../../lib/solvers/BaseSolver"

type DiagnosticSolver = BaseSolver & { getCurrentPhase?: () => string }
type DiagnosticKind = "full06" | "full15" | "memory04" | "memory24"
const kind = process.argv[2] as DiagnosticKind
const label = process.argv[3]!
if (!["full06", "full15", "memory04", "memory24"].includes(kind)) {
  throw new Error(`Unknown diagnostic case: ${kind}`)
}
const fullRun = kind === "full06" || kind === "full15"
const samplePath = fullRun
  ? `node_modules/dataset-srj18/samples/sample${kind === "full06" ? "006" : "015"}.json`
  : `node_modules/@tscircuit/dataset-srj24/samples/sample${kind === "memory04" ? "004" : "024"}.json`
const inputBytes = readFileSync(samplePath, "utf8")
const input = JSON.parse(inputBytes)
const hash = (value: unknown): string => {
  const serialized = JSON.stringify(value)
  const digest = createHash("sha256")
  digest.update(serialized)
  const result = digest.digest("hex")
  return result
}
const inputHash = createHash("sha256").update(inputBytes).digest("hex")
const startupMemory = { ...process.memoryUsage(), maxRssKiB: process.resourceUsage().maxRSS }
const started = performance.now()
const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, { effort: 1, cacheProvider: null })
const targetPhase = kind === "memory04" ? "highDensityRouteSolver" : "edgeSolver"
const targetIterations = kind === "memory04" ? 800_000 : 100_000
let previousPhase = ""
let previousJointPhase = ""
let captured = false
let stopReason = "finished"
const phases: unknown[] = []
const jointPhases: unknown[] = []
while (!solver.solved && !solver.failed) {
  const phase = solver.getCurrentPhase()
  if (phase !== previousPhase) {
    previousPhase = phase
    const event = { phase, iterations: solver.iterations, elapsedMs: performance.now() - started, memory: process.memoryUsage() }
    phases.push(event)
    console.log(JSON.stringify(event))
  }
  if (fullRun && phase === "pipeline9JointDrcRepairSolver") {
    if (!captured) {
      const [params] = solver.pipelineDef[solver.currentPipelineStepIndex].getConstructorParams(solver)
      writeFileSync(`diagnostic-results/${label}-joint-input.json.gz`, gzipSync(JSON.stringify([params], (_key, value) => value instanceof Set ? [...value] : value)))
      console.log(JSON.stringify({ jointInputHash: hash(params.newHdRoutes), routes: params.newHdRoutes.length }))
      captured = true
    }
    const joint = solver.pipeline9JointDrcRepairSolver
    if (joint && joint.getCurrentPhase() !== previousJointPhase) {
      previousJointPhase = joint.getCurrentPhase()
      const event = { phase: previousJointPhase, iterations: joint.iterations, elapsedMs: performance.now() - started, stats: structuredClone(joint.stats) }
      jointPhases.push(event)
      console.log(JSON.stringify(event))
    }
  }
  if (!fullRun && phase === targetPhase && (solver.activeSubSolver?.iterations ?? 0) >= targetIterations) {
    stopReason = "matched-iterations"
    break
  }
  if (performance.now() - started >= (fullRun ? 360_000 : 900_000)) {
    stopReason = "timeout"
    break
  }
  solver.step()
}
const elapsedMs = performance.now() - started
const memory = { ...process.memoryUsage(), maxRssKiB: process.resourceUsage().maxRSS }
const hd = solver.highDensityRouteSolver as any
const partialState = kind === "memory04"
  ? { input: (solver as any).highDensityNodePortPoints, routes: hd.routes, remainingNodes: hd.unsolvedNodePortPoints, activeNode: hd.activeNode, updatedFixedRoutes: hd.getUpdatedFixedHdRoutes(), regularRoutes: hd.activeRegularSolver?.routes, phaseIterations: solver.activeSubSolver?.iterations }
  : { nodes: solver.edgeSolver?.nodes, edges: solver.edgeSolver?.edges, phaseIterations: solver.activeSubSolver?.iterations }
const partialStateHash = fullRun ? undefined : hash(partialState)
const activeChain: unknown[] = []
let child: DiagnosticSolver | null | undefined = solver
while (child) {
  activeChain.push({ name: child.getSolverName(), phase: child.getCurrentPhase?.(), iterations: child.iterations, progress: child.progress, stats: child.stats })
  child = child.activeSubSolver
}
let drcErrors: unknown[] | undefined
let outputHash: string | undefined
if (solver.solved && !solver.failed) {
  const traces = solver.getOutputSimplifiedPcbTraces()
  outputHash = hash(traces)
  drcErrors = evaluateRelaxedDrc({ inputSrj: input, srjWithPointPairs: solver.srjWithPointPairs!, routedTraces: traces }).errors
}
const result = { kind, label, inputHash, partialStateHash, solved: solver.solved, failed: solver.failed, error: solver.error, stopReason, elapsedMs, startupMemory, memory, outputHash, drcErrors, phases, jointPhases, activeChain, phaseTimes: solver.timeSpentOnPhase }
writeFileSync(`diagnostic-results/${label}-result.json`, JSON.stringify(result, null, 2))
console.log(`DIAGNOSTIC_RESULT ${JSON.stringify(result)}`)
if (!fullRun && (stopReason !== "matched-iterations" || solver.activeSubSolver?.iterations !== targetIterations)) {
  throw new Error("Memory comparison did not reach its matched iteration budget")
}
