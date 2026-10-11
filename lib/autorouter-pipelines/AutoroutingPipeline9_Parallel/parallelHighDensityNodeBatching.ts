import type { NodeWithPortPoints } from "../../types/high-density-types"
import { getBoundsFromNodeWithPortPoints } from "../../utils/getBoundsFromNodeWithPortPoints"
import type { Pipeline9ParallelHighDensityContext, Pipeline9ParallelHighDensityNodeResult } from "./parallelWorkerTypes"

export const PARALLEL_HIGH_DENSITY_NODE_BATCH_MAX_SIZE = 16
export type ParallelHighDensityBatchEntry = {
  nodeWithPortPoints: NodeWithPortPoints
  nodePf: number | null
}
export type ParallelHighDensityNodeBatchJob = {
  kind: "highDensityNodeBatch"
  contextId: number
  context: Pipeline9ParallelHighDensityContext
  nodes: ParallelHighDensityBatchEntry[]
}
export type ParallelHighDensityNodeBatchResult = {
  kind: "highDensityNodeBatch"
  results: Array<{ nodeId: string; result: Pipeline9ParallelHighDensityNodeResult }>
}

/**
 * The ordered portfolio's first cached grid candidate solves these same-layer
 * nodes inside its first 100-substep quantum. Layer changes instead have an
 * already solved closed-form candidate. Match the native scale-1 coordinates,
 * expanded bounds and strict same-edge predicate rather than a geometric guess.
 * A batch retains one history client throughout: a previously cached failure
 * can still select another native candidate without changing delivery ownership.
 */
export function isParallelHighDensityBatchEligible(
  node: NodeWithPortPoints, context: Pipeline9ParallelHighDensityContext,
): boolean {
  if ((context.highDensityPolicy ?? "ordered") !== "ordered" || !Array.isArray(node.portPoints) || node.portPoints.length !== 2 ||
      !Number.isFinite(node.width) || node.width <= 0 || !Number.isFinite(node.height) || node.height <= 0 ||
      !node.center || !Number.isFinite(node.center.x) || !Number.isFinite(node.center.y)) return false
  const [a, b] = node.portPoints
  if (!a || !b || a.connectionName !== b.connectionName || typeof a.connectionName !== "string" ||
      ![a.x, a.y, b.x, b.y].every(Number.isFinite) ||
      !Number.isInteger(a.z) || a.z < 0 || a.z >= context.layerCount ||
      !Number.isInteger(b.z) || b.z < 0 || b.z >= context.layerCount) return false
  const scaled = { ...node, portPoints: node.portPoints.map((point) => ({ ...point,
    x: node.center.x + (point.x - node.center.x),
    y: node.center.y + (point.y - node.center.y),
  })) }
  if (!scaled.portPoints.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))) return false
  const bounds = getBoundsFromNodeWithPortPoints(scaled)
  if (!Object.values(bounds).every(Number.isFinite)) return false
  if (a.z !== b.z) return true
  const [start, end] = scaled.portPoints
  if (!start || !end) throw new Error("Two-port batch eligibility lost its endpoints")
  return !(
    (Math.abs(start.x - bounds.minX) < 0.001 && Math.abs(end.x - bounds.minX) < 0.001) ||
    (Math.abs(start.x - bounds.maxX) < 0.001 && Math.abs(end.x - bounds.maxX) < 0.001) ||
    (Math.abs(start.y - bounds.minY) < 0.001 && Math.abs(end.y - bounds.minY) < 0.001) ||
    (Math.abs(start.y - bounds.maxY) < 0.001 && Math.abs(end.y - bounds.maxY) < 0.001)
  )
}

export function assertParallelHighDensityNodeBatchJob(
  job: ParallelHighDensityNodeBatchJob | Omit<ParallelHighDensityNodeBatchJob, "context">,
  context: Pipeline9ParallelHighDensityContext,
): void {
  if (job.kind !== "highDensityNodeBatch" || !Number.isSafeInteger(job.contextId) || job.contextId <= 0 || !Array.isArray(job.nodes) ||
      job.nodes.length < 1 || job.nodes.length > PARALLEL_HIGH_DENSITY_NODE_BATCH_MAX_SIZE) {
    throw new Error("HD node batch must contain between one and 16 nodes and a valid board context")
  }
  const nodeIds = new Set<string>()
  for (const entry of job.nodes) {
    const node = entry?.nodeWithPortPoints
    if (!node || typeof node.capacityMeshNodeId !== "string" || nodeIds.has(node.capacityMeshNodeId) ||
        (entry.nodePf !== null && (typeof entry.nodePf !== "number" || !Number.isFinite(entry.nodePf))) ||
        !isParallelHighDensityBatchEligible(node, context)) {
      throw new Error("HD node batch has an ineligible, duplicate, or malformed node")
    }
    nodeIds.add(node.capacityMeshNodeId)
  }
}

/** Protocol failures are fatal; original algorithm exceptions remain per-node data. */
export function assertParallelHighDensityNodeBatchResult(
  job: ParallelHighDensityNodeBatchJob, result: unknown,
): asserts result is ParallelHighDensityNodeBatchResult {
  assertParallelHighDensityNodeBatchJob(job, job.context)
  if (!result || typeof result !== "object" || !("kind" in result) || result.kind !== job.kind ||
      !("results" in result) || !Array.isArray(result.results) || result.results.length !== job.nodes.length) {
    throw new Error("HD node batch returned an invalid result kind or count")
  }
  for (let index = 0; index < job.nodes.length; index++) {
    const entry: unknown = result.results[index]
    if (!entry || typeof entry !== "object" || !("nodeId" in entry) ||
        entry.nodeId !== job.nodes[index]!.nodeWithPortPoints.capacityMeshNodeId || !("result" in entry)) {
      throw new Error("HD node batch returned a mismatched node identity or order")
    }
    const child = entry.result
    if (!child || typeof child !== "object" || !("status" in child) || typeof child.status !== "string" ||
        !["solved", "failed", "exception"].includes(child.status) ||
        !("nodeStats" in child) || !child.nodeStats || typeof child.nodeStats !== "object" || Array.isArray(child.nodeStats) ||
        !("nodeIterations" in child) || !Number.isSafeInteger(child.nodeIterations) || Number(child.nodeIterations) < 0 ||
        !("nodeMaximumIterations" in child) || typeof child.nodeMaximumIterations !== "number" ||
        !Number.isFinite(child.nodeMaximumIterations) || child.nodeMaximumIterations < 0 || "firstValidStats" in child) {
      throw new Error("HD node batch returned invalid native work or status")
    }
    for (const [key, value] of Object.entries(child.nodeStats)) {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error(`HD node batch returned nonnumeric node statistic ${key}`)
      }
    }
    if (child.status === "solved" && (!("routes" in child) || !Array.isArray(child.routes))) {
      throw new Error("HD node batch returned a solved node without routes")
    }
    if (child.status === "failed" && (!("error" in child) || typeof child.error !== "string")) {
      throw new Error("HD node batch returned a failed node without an error")
    }
    if (child.status === "exception") {
      const exception = "exception" in child ? child.exception : null
      if (!exception || typeof exception !== "object" || !("name" in exception) || typeof exception.name !== "string" ||
          !("message" in exception) || typeof exception.message !== "string" ||
          ("stack" in exception && typeof exception.stack !== "string")) {
        throw new Error("HD node batch returned a malformed node exception")
      }
    }
  }
}
