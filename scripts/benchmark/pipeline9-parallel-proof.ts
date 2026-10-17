import { mkdirSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import sample001 from "dataset-srj18/samples/sample001.json"
import type { SimpleRouteJson } from "../../lib/types/srj-types"
import type { Pipeline9HighDensitySolverParams } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"

import { Pipeline9_Parallel } from "../../lib/autorouter-pipelines/Pipeline9_Parallel/Pipeline9_Parallel"
import { NodeSolverRuntime } from "../../lib/solver-runtime/NodeSolverRuntime"
import { SingleThreadSolverRuntime } from "../../lib/solver-runtime/SolverRuntime"

const mode = process.argv[2] ?? "baseline"
const threads = Number(process.argv[3] ?? 1)
const outputDir = process.argv[4] ?? "/tmp/pipeline9-parallel-proof"
mkdirSync(outputDir, { recursive: true })
const input = structuredClone(sample001) as SimpleRouteJson
const start = performance.now()
const runtime = mode === "serial" ? new SingleThreadSolverRuntime() : mode === "baseline" ? undefined : new NodeSolverRuntime({ threads })
const pipeline = runtime ? new Pipeline9_Parallel(input, { effort: 1, cacheProvider: null, runtime }) : new AutoroutingPipelineSolver9_PreloadedTraceGraph(input, { effort: 1, cacheProvider: null })
let phase = ""
let phaseStart = performance.now()
let captured = false
while (!pipeline.solved && !pipeline.failed) {
  const current = pipeline.getCurrentPhase()
  if (current !== phase) {
    if (phase) console.log(JSON.stringify({ phase, ms: performance.now() - phaseStart }))
    phase = current
    phaseStart = performance.now()
  }
  if (current === "highDensityRouteSolver" && !pipeline.activeSubSolver && !captured) {
    const params = pipeline.pipelineDef[pipeline.currentPipelineStepIndex]!.getConstructorParams(pipeline)[0] as Pipeline9HighDensitySolverParams
    writeFileSync(`${outputDir}/high-density-input.json`, JSON.stringify({ ...params, connMap: undefined, connectivityNetMap: params.connMap.netMap, nodePfById: params.nodePfById instanceof Map ? Object.fromEntries(params.nodePfById) : params.nodePfById }))
    captured = true
    console.log(JSON.stringify({ densityNodes: params.nodePortPoints.length, fixedRoutes: params.fixedHdRoutes.length }))
  }
  pipeline.step()
}
const elapsedMs = performance.now() - start
if (pipeline.failed) throw new Error(pipeline.error ?? "Pipeline failed")
const output = pipeline.getOutputSimpleRouteJson()
const json = JSON.stringify(output)
writeFileSync(`${outputDir}/${mode}.json`, json)
const result = {mode,threads,elapsedMs,iterations:pipeline.iterations,phases:pipeline.timeSpentOnPhase,hash:createHash("sha256").update(json).digest("hex"),node:process.version,bun:(globalThis as any).Bun?.version}
writeFileSync(`${outputDir}/${mode}-timings.json`, JSON.stringify(result,null,2))
console.log(JSON.stringify(result))

runtime?.dispose()
