import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { FirstValidA13WorkerClient } from "./FirstValidA13WorkerClient"
import type { MultiHeadHistoryWorkerClient } from "./MultiHeadHistoryWorkerClient"
import type { GridHistoryWorkerClient } from "./GridHistoryWorkerClient"
import { ParallelMultiHeadHighDensityNodeSolver } from "./ParallelMultiHeadHighDensityNodeSolver"
import type { Pipeline9ParallelHighDensityContext, Pipeline9ParallelHighDensityNodeJob,
  Pipeline9ParallelHighDensityNodeResult } from "./parallelWorkerTypes"

/** Single and batched jobs execute the same complete native node policy. */
export async function executeParallelHighDensityNodeJob(
  job: Omit<Pipeline9ParallelHighDensityNodeJob, "context">,
  context: Pipeline9ParallelHighDensityContext,
  connMap: ConnectivityMap,
  historyClient: MultiHeadHistoryWorkerClient,
  a13Client: FirstValidA13WorkerClient,
  deferAlgorithmException: boolean = false,
  gridClient?: GridHistoryWorkerClient,
): Promise<Pipeline9ParallelHighDensityNodeResult> {
  let solver: ParallelMultiHeadHighDensityNodeSolver | undefined
  let algorithmException: { name: string; message: string; stack?: string } | null = null
  try {
    solver = new ParallelMultiHeadHighDensityNodeSolver({ ...context, connMap,
      nodePortPoints: [job.nodeWithPortPoints], fixedHdRoutes: [],
      nodePfById: { [job.nodeWithPortPoints.capacityMeshNodeId]: job.nodePf } }, historyClient.dispatch,
      context.highDensityPolicy ?? "ordered", (): void => {
        historyClient.cancelUnusedHistories()
        a13Client.cancelUnusedCandidate()
        gridClient?.cancelUnusedHistories()
      }, context.firstValidClearance ?? 0.1,
      job.disableIdleA13Candidate ? undefined : a13Client.dispatch, job.cancellationBuffer,
      context.requirePhysicalCopper, gridClient?.dispatch)
    await solver.solveAsync()
  } catch (error: unknown) {
    // Commit batch exceptions in original node order. A competitive owner also
    // consumes this data before a winner, or discards its cancelled loser.
    if (!deferAlgorithmException && (!solver || !job.cancellationBuffer)) throw error
    algorithmException = error instanceof Error
      ? { name: error.name, message: error.message, ...(error.stack ? { stack: error.stack } : {}) }
      : { name: "Error", message: String(error) }
  }
  const nodeStats: Record<string, number> = {}
  if (solver) {
    for (const [key, value] of Object.entries(solver.stats)) {
      if (typeof value !== "number") throw new Error(`Pipeline9 node statistic ${key} is not numeric`)
      nodeStats[key] = value
    }
  }
  const policyStats = { nodeIterations: solver?.iterations ?? 0,
    nodeMaximumIterations: solver?.MAX_ITERATIONS ?? 100e6 * context.effort,
    ...(context.highDensityPolicy === "first-valid" && solver ? { firstValidStats: solver.firstValidStats } : {}) }
  if (algorithmException) return { status: "exception", exception: algorithmException, nodeStats, ...policyStats }
  if (!solver) throw new Error("HD worker did not construct its native node solver")
  if (solver.solved) return { status: "solved", routes: solver.routes, nodeStats, ...policyStats }
  if (solver.failed && solver.error) return { status: "failed", error: solver.error, nodeStats, ...policyStats }
  if (solver.wasCancelled) return { status: "cancelled", nodeStats, ...policyStats }
  throw new Error("Pipeline9 worker finished without a solved or failed result")
}
