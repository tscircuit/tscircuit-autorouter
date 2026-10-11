import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getGlobalInMemoryCache } from "../../cache/setupGlobalCaches"
import { Pipeline9HighDensitySolver } from "../AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { executeParallelStageJob } from "./parallelStageWorkerJobs"
import type {
  Pipeline9LocalWorkerRequest,
  Pipeline9LocalWorkerResponse,
  Pipeline9ParallelHighDensityContext,
  Pipeline9ParallelHighDensityNodeResult,
} from "./parallelWorkerTypes"

let currentContextId: number | null = null
let currentContext: Pipeline9ParallelHighDensityContext | null = null
let currentConnMap: ConnectivityMap | null = null

self.onmessage = (event: MessageEvent<Pipeline9LocalWorkerRequest>): void => {
  const { taskId, job } = event.data
  try {
    let result: unknown
    if (job.kind === "warmup") result = null
    else if (job.kind !== "highDensityNode") result = executeParallelStageJob(job)
    else {
      if ("context" in job) {
        currentContextId = job.contextId
        currentContext = job.context
        currentConnMap = new ConnectivityMap(job.context.connectivityNetMap)
        // Reusing imports and threads must never turn repeated boards into cache hits.
        getGlobalInMemoryCache().clearCache()
      }
      if (!currentContext || !currentConnMap || currentContextId !== job.contextId) {
        throw new Error(`Pipeline9 worker is missing board context ${job.contextId}`)
      }
      // Execute the complete existing node policy, including regional repair,
      // rather than introducing a second ordinary/regional implementation.
      const solver = new Pipeline9HighDensitySolver({ ...currentContext, connMap: currentConnMap,
        nodePortPoints: [job.nodeWithPortPoints], fixedHdRoutes: [],
        nodePfById: { [job.nodeWithPortPoints.capacityMeshNodeId]: job.nodePf } })
      solver.solve()
      const nodeStats: Record<string, number> = {}
      for (const [key, value] of Object.entries(solver.stats)) {
        if (typeof value !== "number") throw new Error(`Pipeline9 node statistic ${key} is not numeric`)
        nodeStats[key] = value
      }
      if (solver.solved) result = { status: "solved", routes: solver.routes, nodeStats } satisfies Pipeline9ParallelHighDensityNodeResult
      else if (solver.failed && solver.error) result = { status: "failed", error: solver.error, nodeStats } satisfies Pipeline9ParallelHighDensityNodeResult
      else throw new Error("Pipeline9 worker finished without a solved or failed result")
    }
    self.postMessage({ taskId, ok: true, result } satisfies Pipeline9LocalWorkerResponse)
  } catch (error) {
    self.postMessage({ taskId, ok: false,
      error: error instanceof Error ? (error.stack ?? error.message) : String(error) } satisfies Pipeline9LocalWorkerResponse)
  }
}
