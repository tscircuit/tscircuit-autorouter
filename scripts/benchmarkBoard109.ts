import { createHash } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { gzipSync } from "node:zlib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { getPendingEffectsFromSolverTree } from "../lib/solvers/getPendingEffectsFromSolverTree"
import { evaluateRelaxedDrc } from "../lib/testing/evaluate-relaxed-drc"
import type { SimpleRouteJson } from "../lib/types"
import capturedInput from "../fixtures/bug-reports/bugreport109-book-reading-clip-lamp/bugreport109-book-reading-clip-lamp.srj.json"

const outputDirectory = process.argv[2] ?? "board109-results"
const topologyOnly = process.argv.includes("--topology-only")
mkdirSync(outputDirectory, { recursive: true })
const input = structuredClone(capturedInput) as SimpleRouteJson
const started = performance.now()
const cpuStarted = process.cpuUsage()
const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, { cacheProvider: null, effort: 1 })
let phase = ""
while (!solver.solved && !solver.failed) {
  solver.step()
  const currentPhase = solver.getCurrentPhase()
  if (topologyOnly && currentPhase === "topologyMergingSolver") {
    const output = solver.topologyPlanningSolver!.getOutput()
    const result = {
      kind: "topology",
      elapsedMs: performance.now() - started,
      topologyMs: solver.timeSpentOnPhase.topologyPlanningSolver,
      outputSha256: createHash("sha256").update(JSON.stringify(output)).digest("hex"),
      nodeCount: output.globalMeshNodes.length + output.componentMeshNodes.reduce((sum, nodes) => sum + nodes.length, 0),
      stages: solver.timeSpentOnPhase,
    }
    writeFileSync(`${outputDirectory}/result.json`, JSON.stringify(result, null, 2))
    console.log(JSON.stringify(result))
    process.exit(0)
  }
  if (currentPhase !== phase) {
    console.log(JSON.stringify({ phase: currentPhase, elapsedMs: performance.now() - started, stages: solver.timeSpentOnPhase }))
    phase = currentPhase
    if (solver.activeSubSolver && ["highDensitySolver", "pipeline9HighDensitySolver", "traceWidthSolver", "pipeline9JointDrcRepairSolver"].includes(phase)) {
      writeFileSync(`${outputDirectory}/${phase}-input.json.gz`, gzipSync(JSON.stringify(solver.pipelineDef[solver.currentPipelineStepIndex]!.getConstructorParams(solver))))
    }
  }
  const effects = getPendingEffectsFromSolverTree(solver)
  if (effects.length > 0) await Promise.all(effects.map((effect) => effect.promise))
}
const elapsedMs = performance.now() - started
const cpuUsage = process.cpuUsage(cpuStarted)
if (!solver.solved || solver.failed) throw new Error(solver.error ?? "Board 109 failed to route")
const traces = solver.getOutputSimplifiedPcbTraces()
const requestedPairs = solver.srjWithPointPairs!.connections.map((connection) => connection.pointsToConnect.map((point) => point.pcb_port_id!).sort()).sort()
const routedPairs = traces.map((trace) => [...trace.connectsTo!].sort()).sort()
if (JSON.stringify(requestedPairs) !== JSON.stringify(routedPairs)) throw new Error("Board 109 endpoint coverage changed")
const validationStarted = performance.now()
const drc = evaluateRelaxedDrc({ inputSrj: input, srjWithPointPairs: solver.srjWithPointPairs!, routedTraces: traces })
const result = {
  elapsedMs,
  cpuMs: (cpuUsage.user + cpuUsage.system) / 1000,
  validationMs: performance.now() - validationStarted,
  traceCount: traces.length,
  drcErrorCount: drc.errors.length,
  viaCount: traces.reduce((count, trace) => count + trace.route.filter((point) => point.route_type === "via").length, 0),
  outputSha256: createHash("sha256").update(JSON.stringify(traces)).digest("hex"),
  stages: solver.timeSpentOnPhase,
}
writeFileSync(`${outputDirectory}/result.json`, JSON.stringify(result, null, 2))
writeFileSync(`${outputDirectory}/traces.json.gz`, gzipSync(JSON.stringify(traces)))
console.log(JSON.stringify(result))
if (drc.errors.length > 0) throw new Error(`Board 109 has ${drc.errors.length} DRC errors`)
