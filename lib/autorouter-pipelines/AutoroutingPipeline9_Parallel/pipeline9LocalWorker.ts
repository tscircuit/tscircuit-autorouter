import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getGlobalInMemoryCache } from "../../cache/setupGlobalCaches"
import { executeParallelStageJob } from "./parallelStageWorkerJobs"
import { executeMultiHeadHistoryJob } from "./executeMultiHeadHistoryJob"
import { MultiHeadHistoryWorkerClient } from "./MultiHeadHistoryWorkerClient"
import { ParallelMultiHeadHighDensityNodeSolver } from "./ParallelMultiHeadHighDensityNodeSolver"
import type { MultiHeadHistoryDelivery, MultiHeadHistoryGrant } from "./parallelMultiHeadHistoryTypes"
import { restoreWorkerConnectivityMap } from "./restoreWorkerConnectivityMap"
import type {
  Pipeline9LocalWorkerRequest,
  Pipeline9LocalWorkerResponse,
  Pipeline9ParallelHighDensityContext,
  Pipeline9ParallelHighDensityNodeResult,
} from "./parallelWorkerTypes"

let currentContextId: number | null = null
let currentContext: Pipeline9ParallelHighDensityContext | null = null
let currentConnMap: ConnectivityMap | null = null
let historyClient: MultiHeadHistoryWorkerClient | null = null

self.onmessage = (event: MessageEvent<Pipeline9LocalWorkerRequest | MultiHeadHistoryGrant | MultiHeadHistoryDelivery>): void => {
  if ("kind" in event.data) {
    if (!historyClient) throw new Error("Worker received history control without an active owner")
    historyClient.receive(event.data)
    return
  }
  // Keep a completed owner's client until the next job. A delivery may already
  // be posted before the parent observes completion; both messages use the same
  // port, so that delivery is received before any subsequent job request.
  historyClient = null
  void executeWorkerRequest(event.data)
}

async function executeWorkerRequest({ taskId, job }: Pipeline9LocalWorkerRequest): Promise<void> {
  try {
    let result: unknown
    if (job.kind === "warmup") result = null
    else if (job.kind === "multiHeadHistory") result = executeMultiHeadHistoryJob(job)
    else if (job.kind !== "highDensityNode") result = executeParallelStageJob(job)
    else {
      if ("context" in job) {
        currentContextId = job.contextId
        currentContext = job.context
        currentConnMap = restoreWorkerConnectivityMap(job.context)
        // Reusing imports and threads must never turn repeated boards into cache hits.
        getGlobalInMemoryCache().clearCache()
      }
      if (!currentContext || !currentConnMap || currentContextId !== job.contextId) {
        throw new Error(`Pipeline9 worker is missing board context ${job.contextId}`)
      }
      // Execute the complete existing node policy, including regional repair,
      // rather than introducing a second ordinary/regional implementation.
      historyClient = new MultiHeadHistoryWorkerClient(taskId, (request): void => self.postMessage(request))
      const solver = new ParallelMultiHeadHighDensityNodeSolver({ ...currentContext, connMap: currentConnMap,
        nodePortPoints: [job.nodeWithPortPoints], fixedHdRoutes: [],
        nodePfById: { [job.nodeWithPortPoints.capacityMeshNodeId]: job.nodePf } }, historyClient.dispatch,
        currentContext.highDensityPolicy ?? "ordered", historyClient.cancelUnusedHistories,
        currentContext.firstValidClearance ?? 0.1)
      await solver.solveAsync()
      const nodeStats: Record<string, number> = {}
      for (const [key, value] of Object.entries(solver.stats)) {
        if (typeof value !== "number") throw new Error(`Pipeline9 node statistic ${key} is not numeric`)
        nodeStats[key] = value
      }
      const policyStats = currentContext.highDensityPolicy === "first-valid" ? { firstValidStats: solver.firstValidStats } : {}
      if (solver.solved) result = { status: "solved", routes: solver.routes, nodeStats, ...policyStats } satisfies Pipeline9ParallelHighDensityNodeResult
      else if (solver.failed && solver.error) result = { status: "failed", error: solver.error, nodeStats, ...policyStats } satisfies Pipeline9ParallelHighDensityNodeResult
      else throw new Error("Pipeline9 worker finished without a solved or failed result")
    }
    self.postMessage({ taskId, ok: true, result } satisfies Pipeline9LocalWorkerResponse)
  } catch (error) {
    self.postMessage({ taskId, ok: false,
      error: error instanceof Error ? (error.stack ?? error.message) : String(error) } satisfies Pipeline9LocalWorkerResponse)
  }
}
