import { parentPort } from "node:worker_threads"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import type { SimpleRouteJson } from "lib/types"

if (!parentPort)
  throw new Error("Differential-pair result worker has no parent port")
const port = parentPort
port.on("message", async (srj: SimpleRouteJson): Promise<void> => {
  const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(srj, {
    cacheProvider: null,
  })
  try {
    await solver.solveAsync()
  } catch (error) {
    if (!solver.failed || !solver.routingFailure) throw error
  }
  port.postMessage(solver.getResult())
})
