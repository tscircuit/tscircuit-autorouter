import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getGlobalInMemoryCache } from "../../cache/setupGlobalCaches"
import { executeParallelStageJob } from "./parallelStageWorkerJobs"
import { executeMultiHeadHistoryJob } from "./executeMultiHeadHistoryJob"
import { MultiHeadHistoryWorkerClient } from "./MultiHeadHistoryWorkerClient"
import { ParallelMultiHeadHighDensityNodeSolver } from "./ParallelMultiHeadHighDensityNodeSolver"
import type { MultiHeadHistoryDelivery, MultiHeadHistoryGrant } from "./parallelMultiHeadHistoryTypes"
import { restoreWorkerConnectivityMap } from "./restoreWorkerConnectivityMap"
import { FirstValidA13WorkerClient } from "./FirstValidA13WorkerClient"
import { executeFirstValidA13CandidateJob } from "./executeFirstValidA13CandidateJob"
import type { FirstValidA13CandidateDelivery, FirstValidA13CandidateGrant } from "./firstValidA13CandidateTypes"
import { executeFirstValidA13NodeJob } from "./executeFirstValidA13NodeJob"
import type { FirstValidA13NodeJob } from "./parallelHighDensityFrontierTypes"
import type {
  Pipeline9LocalWorkerRequest,
  Pipeline9LocalWorkerResponse,
  Pipeline9ParallelHighDensityContext,
  Pipeline9ParallelHighDensityNodeResult,
  Pipeline9ParallelHighDensityNodeJob,
} from "./parallelWorkerTypes"

let currentContextId: number | null = null
let currentContext: Pipeline9ParallelHighDensityContext | null = null
let currentConnMap: ConnectivityMap | null = null
let historyClient: MultiHeadHistoryWorkerClient | null = null
let a13Client: FirstValidA13WorkerClient | null = null

self.onmessage = (event: MessageEvent<Pipeline9LocalWorkerRequest | MultiHeadHistoryGrant | MultiHeadHistoryDelivery | FirstValidA13CandidateGrant | FirstValidA13CandidateDelivery>): void => {
  if ("kind" in event.data) {
    if (event.data.kind === "firstValidA13CandidateGrant" || event.data.kind === "firstValidA13CandidateDelivery") {
      if (!a13Client) throw new Error("Worker received A13 control without an active owner")
      a13Client.receive(event.data)
    } else {
      if (!historyClient) throw new Error("Worker received history control without an active owner")
      historyClient.receive(event.data)
    }
    return
  }
  // Keep a completed owner's client until the next job. A delivery may already
  // be posted before the parent observes completion; both messages use the same
  // port, so that delivery is received before any subsequent job request.
  historyClient = null
  a13Client = null
  void executeWorkerRequest(event.data)
}

async function executeWorkerRequest({ taskId, job }: Pipeline9LocalWorkerRequest): Promise<void> {
  try {
    let result: unknown
    if (job.kind === "warmup") result = null
    else if (job.kind === "multiHeadHistory") result = executeMultiHeadHistoryJob(job)
    else if (job.kind === "firstValidA13Candidate") result = executeFirstValidA13CandidateJob(job)
    else if (job.kind === "highDensityA13Node") {
      const { context } = getNodeWorkerContext(job)
      result = executeFirstValidA13NodeJob({ ...job, context })
    }
    else if (job.kind !== "highDensityNode") result = executeParallelStageJob(job)
    else {
      const { context, connMap } = getNodeWorkerContext(job)
      // Execute the complete existing node policy, including regional repair,
      // rather than introducing a second ordinary/regional implementation.
      historyClient = new MultiHeadHistoryWorkerClient(taskId, (request): void => self.postMessage(request))
      a13Client = new FirstValidA13WorkerClient(taskId, (request): void => self.postMessage(request))
      const ownerHistoryClient = historyClient
      const ownerA13Client = a13Client
      const solver = new ParallelMultiHeadHighDensityNodeSolver({ ...context, connMap,
        nodePortPoints: [job.nodeWithPortPoints], fixedHdRoutes: [],
        nodePfById: { [job.nodeWithPortPoints.capacityMeshNodeId]: job.nodePf } }, historyClient.dispatch,
        context.highDensityPolicy ?? "ordered", (): void => {
          ownerHistoryClient.cancelUnusedHistories()
          ownerA13Client.cancelUnusedCandidate()
        }, context.firstValidClearance ?? 0.1,
        job.disableIdleA13Candidate ? undefined : a13Client.dispatch, job.cancellationBuffer,
        context.requirePhysicalCopper)
      let algorithmException: { name: string; message: string; stack?: string } | null = null
      try {
        await solver.solveAsync()
      } catch (error: unknown) {
        // A competing owner may have become unused while executing its last
        // original chunk. Preserve the exception as data so its frontier can
        // consume it before a winner, or discard the explicitly cancelled loser.
        if (!job.cancellationBuffer) throw error
        algorithmException = error instanceof Error
          ? { name: error.name, message: error.message, ...(error.stack ? { stack: error.stack } : {}) }
          : { name: "Error", message: String(error) }
      }
      const nodeStats: Record<string, number> = {}
      for (const [key, value] of Object.entries(solver.stats)) {
        if (typeof value !== "number") throw new Error(`Pipeline9 node statistic ${key} is not numeric`)
        nodeStats[key] = value
      }
      const policyStats = { nodeIterations: solver.iterations,
        ...(context.highDensityPolicy === "first-valid" ? { firstValidStats: solver.firstValidStats } : {}) }
      if (algorithmException) result = { status: "exception", exception: algorithmException, nodeStats, ...policyStats } satisfies Pipeline9ParallelHighDensityNodeResult
      else if (solver.solved) result = { status: "solved", routes: solver.routes, nodeStats, ...policyStats } satisfies Pipeline9ParallelHighDensityNodeResult
      else if (solver.failed && solver.error) result = { status: "failed", error: solver.error, nodeStats, ...policyStats } satisfies Pipeline9ParallelHighDensityNodeResult
      else if (solver.wasCancelled) result = { status: "cancelled", nodeStats, ...policyStats } satisfies Pipeline9ParallelHighDensityNodeResult
      else throw new Error("Pipeline9 worker finished without a solved or failed result")
    }
    self.postMessage({ taskId, ok: true, result } satisfies Pipeline9LocalWorkerResponse)
  } catch (error) {
    self.postMessage({ taskId, ok: false,
      error: error instanceof Error ? (error.stack ?? error.message) : String(error) } satisfies Pipeline9LocalWorkerResponse)
  }
}

function getNodeWorkerContext(job: Pipeline9ParallelHighDensityNodeJob | FirstValidA13NodeJob |
  Omit<Pipeline9ParallelHighDensityNodeJob, "context"> | Omit<FirstValidA13NodeJob, "context">): {
    context: Pipeline9ParallelHighDensityContext; connMap: ConnectivityMap
  } {
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
  return { context: currentContext, connMap: currentConnMap }
}
