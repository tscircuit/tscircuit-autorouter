import { mkdirSync, writeFileSync } from "node:fs"
import { gzipSync } from "node:zlib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { Pipeline9JointDrcRepairSolver } from "../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"
import { loadScenarioBySampleNumber } from "./benchmark/scenarios"
import { loadPipeline9JointDrcInput } from "../tests/fixtures/loadPipeline9JointDrcInput"

mkdirSync("diagnostics", { recursive: true })
const mode = process.argv[2]
const started = performance.now()
if (mode === "capture") {
  const { scenario } = await loadScenarioBySampleNumber("srj18", 14, 1)
  const pipeline = new AutoroutingPipelineSolver9_PreloadedTraceGraph(scenario, { cacheProvider: null, effort: 1 })
  let lastPhase = ""
  while (!pipeline.solved && !pipeline.failed) {
    const phase = pipeline.pipelineDef[pipeline.currentPipelineStepIndex]?.solverName
    if (phase !== lastPhase) {
      console.log(JSON.stringify({ phase, elapsedMs: performance.now() - started }))
      lastPhase = phase
    }
    const joint = pipeline.activeSubSolver
    if (joint instanceof Pipeline9JointDrcRepairSolver) {
      writeFileSync("diagnostics/linux-joint-input.json.gz", gzipSync(JSON.stringify([joint.params], (_, value) => value instanceof Set ? [...value] : value)))
      console.log(JSON.stringify({ captured: true, initialStats: joint.stats }))
      process.exit(0)
    }
    pipeline.step()
  }
  throw new Error(pipeline.error ?? "Pipeline did not enter joint repair")
}
if (mode !== "repair") throw new Error("Expected capture or repair")
const solver = new Pipeline9JointDrcRepairSolver(loadPipeline9JointDrcInput("diagnostics/linux-joint-input.json.gz"))
let lastLog = -Infinity
let lastPhase = ""
while (!solver.solved && !solver.failed) {
  const phase = solver.getCurrentPhase()
  if (phase !== lastPhase || performance.now() - lastLog >= 10000) {
    const chain: unknown[] = []
    let active: any = solver
    while (active) {
      chain.push({ name: active.constructor.name, iterations: active.iterations, phase: active.state?.phase, stats: active.stats, result: active.result ? { ...active.result, routes: undefined } : undefined })
      active = active.activeSubSolver
    }
    console.log(JSON.stringify({ elapsedMs: performance.now() - started, phase, chain }))
    lastLog = performance.now()
    lastPhase = phase
  }
  solver.step()
}
writeFileSync("diagnostics/repair-result.json", JSON.stringify({ solved: solver.solved, failed: solver.failed, error: solver.error, elapsedMs: performance.now() - started, stats: solver.stats }, null, 2))
console.log(JSON.stringify({ elapsedMs: performance.now() - started, stats: solver.stats }))
if (solver.failed) throw new Error(solver.error!)
