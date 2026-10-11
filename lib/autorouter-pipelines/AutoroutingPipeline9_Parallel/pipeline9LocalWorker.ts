import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getGlobalInMemoryCache } from "../../cache/setupGlobalCaches"
import { executeParallelStageJob } from "./parallelStageWorkerJobs"
import { executeMultiHeadHistoryJob } from "./executeMultiHeadHistoryJob"
import { MultiHeadHistoryWorkerClient } from "./MultiHeadHistoryWorkerClient"
import { GridHistoryWorkerClient } from "./GridHistoryWorkerClient"
import { registerWorkerNativeGridKernelDispatcher } from "./workerNativeGridKernelQuantum"
import { initializeReferenceDrcRuntime } from "./authoritative-drc-fork/initializeReferenceDrcRuntime"
import { initializeWorkerNativeGridRuntime } from "./workerNativeGridRuntime"
import { executeGridHistoryJob } from "./executeGridHistoryJob"
import type { GridHistoryDelivery, GridHistoryGrant } from "./parallelGridHistoryTypes"
import { executeParallelHighDensityNodeJob } from "./executeParallelHighDensityNodeJob"
import { assertParallelHighDensityNodeBatchJob, type ParallelHighDensityNodeBatchJob, type ParallelHighDensityNodeBatchResult } from "./parallelHighDensityNodeBatching"
import type { MultiHeadHistoryDelivery, MultiHeadHistoryGrant } from "./parallelMultiHeadHistoryTypes"
import { restoreWorkerConnectivityMap } from "./restoreWorkerConnectivityMap"
import { FirstValidA13WorkerClient } from "./FirstValidA13WorkerClient"
import { executeFirstValidA13CandidateJob } from "./executeFirstValidA13CandidateJob"
import type { FirstValidA13CandidateDelivery, FirstValidA13CandidateGrant } from "./firstValidA13CandidateTypes"
import { executeFirstValidA13NodeJob } from "./executeFirstValidA13NodeJob"
import type { FirstValidA13NodeJob } from "./parallelHighDensityFrontierTypes"
import { deserializePipeline9SharedContext } from "./Pipeline9SharedContextCodec"
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
let gridClient: GridHistoryWorkerClient | null = null
let a13Client: FirstValidA13WorkerClient | null = null

self.onmessage = (event: MessageEvent<Pipeline9LocalWorkerRequest | MultiHeadHistoryGrant | MultiHeadHistoryDelivery | GridHistoryGrant | GridHistoryDelivery | FirstValidA13CandidateGrant | FirstValidA13CandidateDelivery>): void => {
  if ("kind" in event.data) {
    if (event.data.kind === "firstValidA13CandidateGrant" || event.data.kind === "firstValidA13CandidateDelivery") {
      if (!a13Client) throw new Error("Worker received A13 control without an active owner")
      a13Client.receive(event.data)
    } else if (event.data.kind === "gridHistoryGrant" || event.data.kind === "gridHistoryDelivery") {
      if (!gridClient) throw new Error("Worker received grid history control without an active owner")
      gridClient.receive(event.data)
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
  gridClient = null
  a13Client = null
  void executeWorkerRequest(event.data)
}

async function executeWorkerRequest({ taskId, job, sharedContext, idleWorkerAvailability }: Pipeline9LocalWorkerRequest): Promise<void> {
  try {
    if (idleWorkerAvailability !== undefined &&
        (typeof SharedArrayBuffer === "undefined" || !(idleWorkerAvailability instanceof SharedArrayBuffer) ||
          idleWorkerAvailability.byteLength !== Int32Array.BYTES_PER_ELEMENT)) {
      throw new Error("Worker idle availability must contain one shared atomic word")
    }
    if (sharedContext) {
      const expectedFamily = job.kind === "highDensityNode" || job.kind === "highDensityA13Node" || job.kind === "highDensityNodeBatch"
        ? "high-density" : job.kind === "simplifyPathWave" || job.kind === "simplifyPathLookahead" ? "simplification"
        : job.kind === "globalDrcForceTrial" ? "global-drc" : undefined
      if (!expectedFamily || sharedContext.family !== expectedFamily || !("contextId" in job) ||
        sharedContext.contextId !== job.contextId || "context" in job) {
        throw new Error("Shared board context does not match its Pipeline9 worker job")
      }
      const context = await deserializePipeline9SharedContext(sharedContext)
      job = { ...job, context } as Pipeline9LocalWorkerRequest["job"]
    }
    if (job.kind === "simplifyPathLookahead") await initializeReferenceDrcRuntime()
    let result: unknown
    if (job.kind === "warmup") result = null
    else if (job.kind === "multiHeadHistory") result = executeMultiHeadHistoryJob(job)
    else if (job.kind === "gridHistory") result = executeGridHistoryJob(job)
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
      gridClient = new GridHistoryWorkerClient(taskId, (request): void => self.postMessage(request),
        idleWorkerAvailability ? new Int32Array(idleWorkerAvailability) : undefined)
      a13Client = new FirstValidA13WorkerClient(taskId, (request): void => self.postMessage(request))
      const ownerHistoryClient = historyClient
      const ownerGridClient = gridClient
      await initializeWorkerNativeGridRuntime()
      registerWorkerNativeGridKernelDispatcher(ownerGridClient.dispatch)
      const ownerA13Client = a13Client
      if (job.kind === "highDensityNodeBatch") {
        assertParallelHighDensityNodeBatchJob(job, context)
        const batch: ParallelHighDensityNodeBatchResult = { kind: "highDensityNodeBatch", results: [] }
        for (const entry of job.nodes) {
          const child = await executeParallelHighDensityNodeJob({ kind: "highDensityNode", contextId: job.contextId,
            ...entry }, context, connMap, ownerHistoryClient, ownerA13Client, true, ownerGridClient)
          batch.results.push({ nodeId: entry.nodeWithPortPoints.capacityMeshNodeId, result: child })
        }
        result = batch
      } else {
        result = await executeParallelHighDensityNodeJob(job, context, connMap, ownerHistoryClient, ownerA13Client, false, ownerGridClient)
      }
    }
    self.postMessage({ taskId, ok: true, result,
      ...(gridClient && idleWorkerAvailability ? { gridHistoryRequestsSkippedForNoIdleWorker: gridClient.requestsSkippedForNoIdleWorker } : {}),
      ...(gridClient ? { gridHistoryReplayWork: gridClient.replayWork } : {}) } satisfies Pipeline9LocalWorkerResponse)
  } catch (error) {
    self.postMessage({ taskId, ok: false,
      ...(gridClient && idleWorkerAvailability ? { gridHistoryRequestsSkippedForNoIdleWorker: gridClient.requestsSkippedForNoIdleWorker } : {}),
      error: error instanceof Error ? (error.stack ?? error.message) : String(error),
      ...(gridClient ? { gridHistoryReplayWork: gridClient.replayWork } : {}) } satisfies Pipeline9LocalWorkerResponse)
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
