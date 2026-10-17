import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import { createHash } from "node:crypto"
import type { Pipeline9HighDensitySolverParams } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import type { SimpleRouteJson } from "../../lib/types/srj-types"

const mode = process.argv[2] ?? "sync"
if (mode !== "sync" && mode !== "async") throw new Error("Expected sync or async mode")
const workerCount = Number(process.argv[3] ?? 8)
const outputDir = process.argv[4] ?? "/tmp/pipeline9-async"
mkdirSync(outputDir, { recursive: true })
const useBuiltPackage = process.argv[5] === "built"
const moduleUrl = new URL(useBuiltPackage ? "../../dist/index.js" : "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph.ts", import.meta.url)
const { AutoroutingPipelineSolver9_PreloadedTraceGraph } = await import(moduleUrl.href) as typeof import("../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph")
const sampleText = readFileSync(createRequire(import.meta.url).resolve("dataset-srj18/samples/sample002.json"), "utf8")
const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(JSON.parse(sampleText) as SimpleRouteJson, { effort: 1, cacheProvider: null })
const start = performance.now()
let phase = ""
while (!solver.solved && !solver.failed) {
  const current = solver.getCurrentPhase()
  if (current !== phase) {
    if (phase) console.log(JSON.stringify({ phase, ms: solver.timeSpentOnPhase[phase] }))
    phase = current
  }
  if (current === "highDensityRouteSolver" && !solver.activeSubSolver) {
    const params = solver.pipelineDef[solver.currentPipelineStepIndex]!.getConstructorParams(solver)[0] as Pipeline9HighDensitySolverParams
    writeFileSync(`${outputDir}/high-density-input.json`, JSON.stringify({ ...params, connMap: undefined, connectivityNetMap: params.connMap.netMap, nodePfById: params.nodePfById instanceof Map ? Object.fromEntries(params.nodePfById) : params.nodePfById }))
    console.log(JSON.stringify({ nodes: params.nodePortPoints.length, fixedRoutes: params.fixedHdRoutes.length }))
  }
  if (mode === "async" && current === "highDensityRouteSolver") await solver.solveAsync({ workerCount })
  else solver.step()
}
if (solver.failed) throw new Error(solver.error!)
const elapsedMs = performance.now() - start
const output = JSON.stringify(solver.getOutputSimpleRouteJson())
const result = { mode, workerCount, useBuiltPackage, elapsedMs, iterations: solver.iterations, highDensityIterations: solver.highDensityRouteSolver!.iterations, phases: solver.timeSpentOnPhase, hash: createHash("sha256").update(output).digest("hex"), node: process.version, bun: process.versions.bun }
writeFileSync(`${outputDir}/${mode}.json`, output)
writeFileSync(`${outputDir}/${mode}-timings.json`, JSON.stringify(result, null, 2))
console.log(JSON.stringify(result))
