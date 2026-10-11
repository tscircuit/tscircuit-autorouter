import type {
  ParallelForceImproveNodeJob, ParallelIndexedNodeJob, ParallelIndexedNodeResult,
  ParallelNodeBatchJob, ParallelNodeBatchResult,
  ParallelNodeResult, ParallelRepairNodeJob, ParallelStageWorkerPool,
} from "./parallelStageWorkerTypes"

export const PARALLEL_NODE_BATCH_MAX_SIZE = 64
export type ParallelWeightedNodeJob = ParallelIndexedNodeJob & { weight: number }
export type ParallelNodeJobDispatch = {
  kind: "single"
  entry: ParallelWeightedNodeJob
} | {
  kind: "batch"
  job: ParallelNodeBatchJob
}

function createParallelNodeDispatch(entries: ParallelWeightedNodeJob[]): ParallelNodeJobDispatch {
  if (entries.length === 1) return { kind: "single", entry: entries[0]! }
  const first = entries[0]
  if (!first) throw new Error("Cannot dispatch an empty node batch")
  if (first.job.kind === "forceImproveNode") {
    const jobs: ParallelIndexedNodeJob<ParallelForceImproveNodeJob>[] = []
    for (const entry of entries) {
      if (entry.job.kind !== "forceImproveNode") throw new Error("Node batch mixes solver kinds")
      jobs.push({ entryIndex: entry.entryIndex, job: entry.job })
    }
    return { kind: "batch", job: { kind: "forceImproveNodeBatch", jobs } }
  }
  const jobs: ParallelIndexedNodeJob<ParallelRepairNodeJob>[] = []
  for (const entry of entries) {
    if (entry.job.kind !== "repairNode") throw new Error("Node batch mixes solver kinds")
    jobs.push({ entryIndex: entry.entryIndex, job: entry.job })
  }
  return { kind: "batch", job: { kind: "repairNodeBatch", jobs } }
}

/** Pack adjacent light jobs without changing the stage's stable scheduling order. */
export function getParallelNodeJobDispatches(
  entries: readonly ParallelWeightedNodeJob[], workerCount: number = 4,
): ParallelNodeJobDispatch[] {
  if (!Number.isInteger(workerCount) || workerCount < 1 || workerCount > 4) {
    throw new Error("Node batching workerCount must be between one and four")
  }
  let totalWeight = 0
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.weight) || entry.weight < 0 ||
        !Number.isSafeInteger(entry.entryIndex) || entry.entryIndex < 0) {
      throw new Error("Node batching requires nonnegative integer indexes and weights")
    }
    totalWeight += entry.weight
  }
  if (!Number.isSafeInteger(totalWeight)) throw new Error("Node batching total weight overflowed")
  const weightBudget = Math.max(1, totalWeight / (workerCount * 4))
  const dispatches: ParallelNodeJobDispatch[] = []
  let pending: ParallelWeightedNodeJob[] = []
  let pendingWeight = 0
  for (const entry of entries) {
    const differentKind = pending.length > 0 && pending[0]!.job.kind !== entry.job.kind
    if (pending.length > 0 && (differentKind || entry.weight > weightBudget ||
        pending.length >= PARALLEL_NODE_BATCH_MAX_SIZE || pendingWeight + entry.weight > weightBudget)) {
      dispatches.push(createParallelNodeDispatch(pending))
      pending = []
      pendingWeight = 0
    }
    if (entry.weight > weightBudget) {
      dispatches.push({ kind: "single", entry })
      continue
    }
    pending.push(entry)
    pendingWeight += entry.weight
  }
  if (pending.length > 0) dispatches.push(createParallelNodeDispatch(pending))
  return dispatches
}

export function assertParallelNodeBatchJob(job: ParallelNodeBatchJob): void {
  if (!Array.isArray(job.jobs) || job.jobs.length < 1 || job.jobs.length > PARALLEL_NODE_BATCH_MAX_SIZE) {
    throw new Error("Node batch must contain between one and 64 jobs")
  }
  const indexes = new Set<number>()
  const expectedKind = job.kind === "forceImproveNodeBatch" ? "forceImproveNode" : "repairNode"
  for (const entry of job.jobs) {
    if (!entry || !Number.isSafeInteger(entry.entryIndex) || entry.entryIndex < 0 ||
        indexes.has(entry.entryIndex) || !entry.job || entry.job.kind !== expectedKind) {
      throw new Error("Node batch has an invalid, duplicate, or mismatched child")
    }
    indexes.add(entry.entryIndex)
  }
}

/** Worker protocol errors remain fatal even when every solver child completed. */
export function assertParallelNodeBatchResult(
  job: ParallelNodeBatchJob, result: unknown,
): asserts result is ParallelNodeBatchResult {
  assertParallelNodeBatchJob(job)
  if (!result || typeof result !== "object" || !("kind" in result) || result.kind !== job.kind ||
      !("results" in result) || !Array.isArray(result.results) || result.results.length !== job.jobs.length) {
    throw new Error("Node batch worker returned an invalid result kind or count")
  }
  for (let index = 0; index < job.jobs.length; index++) {
    const requested = job.jobs[index]!
    const entry: unknown = result.results[index]
    if (!entry || typeof entry !== "object" || !("entryIndex" in entry) ||
        entry.entryIndex !== requested.entryIndex || !("result" in entry)) {
      throw new Error("Node batch worker returned an invalid child index or order")
    }
    const child = entry.result
    if (!child || typeof child !== "object" || !("kind" in child) || child.kind !== requested.job.kind) {
      throw new Error("Node batch worker returned a mismatched solver child")
    }
    if (requested.job.kind === "forceImproveNode") {
      if (!("routes" in child) || !Array.isArray(child.routes) || child.routes.length !== requested.job.hdRoutes.length) {
        throw new Error("Force node batch worker returned an invalid route count")
      }
    } else if (!("repairedRoutes" in child) || !Array.isArray(child.repairedRoutes) ||
        !("stats" in child) || !child.stats || typeof child.stats !== "object" || Array.isArray(child.stats)) {
      throw new Error("Repair node batch worker returned invalid routes or stats")
    }
  }
}

export async function runParallelNodeJobDispatch(
  dispatch: ParallelNodeJobDispatch, pool: ParallelStageWorkerPool,
): Promise<ParallelIndexedNodeResult[]> {
  if (dispatch.kind === "single") {
    const result = await pool.run<ParallelNodeResult>(dispatch.entry.job)
    return [{ entryIndex: dispatch.entry.entryIndex, result }]
  }
  const result = await pool.run<ParallelNodeBatchResult>(dispatch.job)
  assertParallelNodeBatchResult(dispatch.job, result)
  return result.results
}
