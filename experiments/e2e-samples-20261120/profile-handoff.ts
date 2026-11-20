import { gunzipSync, gzipSync } from "node:zlib"
import { mkdirSync, writeFileSync } from "node:fs"
const routerRoot = process.env.ROUTER_ROOT ?? "/workspace/ddr2402-stitch-final-check"
const capturePath = process.argv[2]
const outputPath = process.argv[3] ?? "/tmp/pipeline9-via-trace-stages"
if (!capturePath) throw new Error("usage: bun replay-pipeline9-via-trace-stages.ts input.json.gz output-directory")
const { AutoroutingPipelineSolver9_PreloadedTraceGraph } = await import(`${routerRoot}/lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph.ts`)
const { createPipeline9AutoroutingDrcEvaluator } = await import(`${routerRoot}/lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9AutoroutingDrcEvaluator.ts`)
const { convertPipeline7HdRoutesToSimplifiedPcbTraces } = await import(`${routerRoot}/lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces.ts`)
const { canonicalizePipeline9HdRoutes } = await import(`${routerRoot}/lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/canonicalizePipeline9HdRoutes.ts`)
let input = JSON.parse(gunzipSync(await Bun.file(capturePath).arrayBuffer()).toString())
if (Array.isArray(input)) input = input[0].input ?? input[0]
const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, { cacheProvider: null })
mkdirSync(outputPath, { recursive: true })
const stages: unknown[] = []
function inspect(completedPhase: string): void {
  let traces
  if (solver.highDensityStitchSolver) {
    traces = solver.getNewTracesBeforePowerExpansion()
  } else if (solver.highDensityRouteSolver?.solved) {
    traces = convertPipeline7HdRoutesToSimplifiedPcbTraces({
      connections: solver.netToPointPairsSolver?.newConnections ?? [],
      originalConnections: solver.originalSrj.connections,
      hdRoutes: canonicalizePipeline9HdRoutes(solver.highDensityRouteSolver.routes),
      layerCount: solver.srj.layerCount,
      obstacles: solver.srj.obstacles,
      defaultViaHoleDiameter: solver.viaHoleDiameter,
      connMap: solver.connMap,
    })
  }
  if (completedPhase === "powerTraceExpansionSolver") traces = solver.getOutputSimpleRouteJson().traces
  if (!traces) return
  const evaluator = createPipeline9AutoroutingDrcEvaluator({ inputSrj: solver.originalSrj, srjWithPointPairs: solver.srjWithPointPairs ?? solver.srj })
  const result = evaluator(traces, { includeTraceContinuity: false })
  const errors = result.errors.filter((error: any) => error.type === "pcb_via_trace_clearance_error")
  const row = { completedPhase, allErrorTypes: result.errors.map((error: any) => error.type), viaTraceErrors: errors, traceCount: traces.length, viaCount: traces.reduce((sum: number, trace: any) => sum + trace.route.filter((point: any) => point.route_type === "via").length, 0), stats: (solver as any)[completedPhase]?.stats }
  console.log(JSON.stringify(row))
  stages.push(row)
  writeFileSync(`${outputPath}/${String(stages.length).padStart(2,"0")}-${completedPhase}.json.gz`, gzipSync(JSON.stringify({ row, traces })))
}
let phase = solver.getCurrentPhase()
while (!solver.solved && !solver.failed) {
  solver.step()
  const nextPhase = solver.getCurrentPhase()
  if (nextPhase !== phase) { inspect(phase); phase = nextPhase }
}
console.log(JSON.stringify({ solved: solver.solved, failed: solver.failed, error: solver.error, iterations: solver.iterations, timeSpentOnPhase: solver.timeSpentOnPhase }))
writeFileSync(`${outputPath}/summary.json`, JSON.stringify(stages, null, 2))
