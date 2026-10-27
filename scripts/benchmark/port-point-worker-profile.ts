import { createRequire } from "node:module"
import { createAutorouterSolverRuntime } from "../../lib/runtime/node"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph as Pipeline9 } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "../../lib/types"

const require = createRequire(import.meta.url)
const { dataset } = require("dataset-srj18") as { dataset: Record<string, SimpleRouteJson> }
const sample = `sample${String(Number(process.argv[2])).padStart(3, "0")}`
const workerCount = Number(process.argv[3])
const input = dataset[sample]
if (!input || ![1, 4].includes(workerCount)) throw new Error("Invalid profiling sample or worker count")
const pipeline = new Pipeline9(structuredClone(input), { effort: 1, cacheProvider: null })
while (pipeline.getCurrentPhase() !== "portPointPathingSolver") {
  pipeline.step()
  if (pipeline.failed || pipeline.solved) throw new Error(pipeline.error ?? "Port-point phase unavailable")
}
pipeline.step()
const phase = pipeline.portPointPathingSolver
if (!phase) throw new Error("Port-point phase was not created")
const runtime = createAutorouterSolverRuntime({ workerCount, requireWorker: true })
try {
  await phase.solveAsync(runtime)
  if (!phase.solved || phase.failed) throw new Error(phase.error ?? "Profiled phase did not solve")
  console.log(JSON.stringify({ sample, workerCount, metrics: phase.getSolveGraphBenchmarkMetrics() }))
} finally { await runtime.dispose() }
