import { mkdirSync } from "node:fs"
import { loadScenarioBySampleNumber } from "./benchmark/scenarios"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { evaluateRelaxedDrc } from "lib/testing/evaluate-relaxed-drc"
import { getNewViaPadViolations } from "@tscircuit/repair04"

const variant = process.argv[2]
const { scenario } = await loadScenarioBySampleNumber("srj33", 32)
const input = structuredClone(scenario)
if (variant === "via-in-pad" || variant === "small-via-in-pad") {
  input.allowViaInPad = true
}
if (variant === "small-via-in-pad") {
  input.minViaDiameter = 0.3
  input.minViaPadDiameter = 0.3
  input.min_via_pad_diameter = 0.3
  input.minViaHoleDiameter = 0.15
  input.min_via_hole_diameter = 0.15
}
const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, { cacheProvider: null, effort: 1 })
const started = performance.now()
let lastPhase = ""
while (!solver.solved && !solver.failed) {
  const phase = solver.getCurrentPhase()
  if (phase !== lastPhase) {
    console.log(JSON.stringify({ variant, phase, elapsedMs: performance.now() - started }))
    lastPhase = phase
  }
  solver.step()
}
if (solver.failed) throw new Error(solver.error!)
const traces = solver.getOutputSimplifiedPcbTraces()
const validation = evaluateRelaxedDrc({ inputSrj: input, srjWithPointPairs: solver.srjWithPointPairs!, routedTraces: traces })
const routes = solver._getOutputHdRoutes()
const expandedSrj = { ...input, connections: [...input.connections, ...solver.srjWithPointPairs!.connections] }
const viaPadViolations = getNewViaPadViolations({ srj: expandedSrj, routes, previousRoutes: [], viaClearance: 0.1 }).filter((violation) => {
  const route = routes[violation.routeIndex]!
  const obstacle = input.obstacles[violation.obstacleIndex]!
  const routeNet = solver.connMap.getNetConnectedToId(route.connectionName)
  return !obstacle.connectedTo.some((id) => routeNet !== undefined && solver.connMap.getNetConnectedToId(id) === routeNet)
})
const result = { variant, elapsedMs: performance.now() - started, solved: solver.solved, drcErrors: validation.errors, foreignViaPadViolations: viaPadViolations, stats: solver.pipeline9JointDrcRepairSolver?.stats, stages: solver.timeSpentOnPhase }
mkdirSync("debug-artifacts", { recursive: true })
await Bun.write(`debug-artifacts/${variant}.json`, JSON.stringify({ ...result, input, routes, traces, srjWithPointPairs: solver.srjWithPointPairs, circuitJson: validation.circuitJson }, null, 2))
console.log(JSON.stringify(result, null, 2))
