import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs"
import { gzipSync, gunzipSync } from "node:zlib"
import { resolve } from "node:path"

const repository = resolve(process.argv[2])
const { AutoroutingPipelineSolver9_PreloadedTraceGraph: Pipeline } = await import(`${repository}/lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph.ts`)
const { TinyHyperGraphSolver } = await import(`${repository}/node_modules/tiny-hypergraph/lib/core.ts`)

const output = process.argv[3]
mkdirSync(output, { recursive: true })
const input = JSON.parse(gunzipSync(readFileSync(`${repository}/tests/fixtures/icepi-local-other-signals.json.gz`)).toString("utf8"))
const pipeline = new Pipeline(input, { cacheProvider: null })
const start = performance.now()
const cpu = process.cpuUsage()
const pending = (solver) => solver.state.unroutedRoutes.length + Number(solver.state.currentRouteId !== undefined)
const log = (event, record) => appendFileSync(`${output}/events.jsonl`, JSON.stringify({event, seconds:(performance.now()-start)/1000,...record})+"\n")
writeFileSync(`${output}/events.jsonl`, "")
let graph
let phase
while (!pipeline.failed && !pipeline.solved) {
  pipeline.step()
  const active = pipeline.portPointPathingSolver?.activeSubSolver
  if (!graph && active instanceof TinyHyperGraphSolver) {
    graph = active
    const tiny = pipeline.portPointPathingSolver.tinyPipelineSolver
    writeFileSync(`${output}/graph-input.json.gz`, gzipSync(JSON.stringify({topology:graph.topology,problem:graph.problem,options:tiny.getSolveGraphOptions()}, (_key,item) => ArrayBuffer.isView(item) ? {typedArray:item.constructor.name,values:Array.from(item)} : item), {level:9}))
    log("graph-created", {routes:graph.problem.routeCount,iterations:graph.iterations,reservedPorts:Array.from(graph.problem.portReservationNetId??[]).filter(n=>n>=0).length})
    const create = graph.createGreedyFinalRouteSolver
    graph.createGreedyFinalRouteSolver = function(options, attempt) {
      const child = create.call(this, options, attempt)
      const reset = child.resetRoutingStateForRerip
      child.resetRoutingStateForRerip = function() {
        const before = pending(this)
        const result = reset.call(this)
        log("reset", {attempt,before,after:pending(this),rips:this.state.ripCount,budget:this.remainingReripBudget})
        return result
      }
      const solve = child.solve
      child.solve = function() {
        const result = solve.call(this)
        log("finisher", {attempt,solved:this.solved,failed:this.failed,error:this.error,pending:pending(this),rips:this.state.ripCount,iterations:this.iterations})
        return result
      }
      return child
    }
  }
  if (pipeline.getCurrentPhase() !== phase) {
    phase = pipeline.getCurrentPhase()
    log("phase", {phase})
  }
}
const used = process.cpuUsage(cpu)
const result = {seconds:(performance.now()-start)/1000,cpuSeconds:(used.user+used.system)/1e6,solved:pipeline.solved,failed:pipeline.failed,error:pipeline.error,phase,graphSolved:graph?.solved,graphFailed:graph?.failed,graphPending:graph&&pending(graph),graphRoutes:graph?.problem.routeCount,graphStats:graph?.stats}
writeFileSync(`${output}/result.json`, JSON.stringify(result,null,2)+"\n")
if (pipeline.solved) writeFileSync(`${output}/output.srj.json.gz`,gzipSync(JSON.stringify(pipeline.getOutputSimpleRouteJson())))
log("result", result)
