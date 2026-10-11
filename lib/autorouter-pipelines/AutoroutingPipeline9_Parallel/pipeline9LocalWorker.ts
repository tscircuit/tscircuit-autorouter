import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getGlobalInMemoryCache } from "../../cache/setupGlobalCaches"
import { executeParallelStageJob } from "./parallelStageWorkerJobs"
import { executeMultiHeadHistoryJob } from "./executeMultiHeadHistoryJob"
import { MultiHeadHistoryWorkerClient } from "./MultiHeadHistoryWorkerClient"
import { executeParallelHighDensityNodeJob } from "./executeParallelHighDensityNodeJob"
import { assertParallelHighDensityNodeBatchJob, type ParallelHighDensityNodeBatchJob, type ParallelHighDensityNodeBatchResult } from "./parallelHighDensityNodeBatching"
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
    else if (job.kind !== "highDensityNode" && job.kind !== "highDensityNodeBatch") result = executeParallelStageJob(job)
    else {
      const { context, connMap } = getNodeWorkerContext(job)
      // One client owns the entire request, including every sequential batch
      // child. Request IDs never restart and late deliveries retain their exact
      // original promises until the next outer job arrives on this message port.
      historyClient = new MultiHeadHistoryWorkerClient(taskId, (request): void => self.postMessage(request))
      a13Client = new FirstValidA13WorkerClient(taskId, (request): void => self.postMessage(request))
      const ownerHistoryClient = historyClient
      const ownerA13Client = a13Client
      if (job.kind === "highDensityNodeBatch") {
        assertParallelHighDensityNodeBatchJob(job, context)
        const batch: ParallelHighDensityNodeBatchResult = { kind: "highDensityNodeBatch", results: [] }
        for (const entry of job.nodes) {
          const child = await executeParallelHighDensityNodeJob({ kind: "highDensityNode", contextId: job.contextId,
            ...entry }, context, connMap, ownerHistoryClient, ownerA13Client, true)
          batch.results.push({ nodeId: entry.nodeWithPortPoints.capacityMeshNodeId, result: child })
        }
        result = batch
      } else {
        result = await executeParallelHighDensityNodeJob(job, context, connMap, ownerHistoryClient, ownerA13Client)
      }
    }
    self.postMessage({ taskId, ok: true, result } satisfies Pipeline9LocalWorkerResponse)
  } catch (error) {
    self.postMessage({ taskId, ok: false,
      error: error instanceof Error ? (error.stack ?? error.message) : String(error) } satisfies Pipeline9LocalWorkerResponse)
  }
}

function getNodeWorkerContext(job: Pipeline9ParallelHighDensityNodeJob | FirstValidA13NodeJob | ParallelHighDensityNodeBatchJob |
  Omit<Pipeline9ParallelHighDensityNodeJob, "context"> | Omit<FirstValidA13NodeJob, "context"> |
  Omit<ParallelHighDensityNodeBatchJob, "context">): {
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
