import type { NodeWithPortPoints } from "../../types/high-density-types"
import { Pipeline9HighDensitySolver, type Pipeline9HighDensitySolverParams } from "../AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { Pipeline9LocalWorkerPool } from "./Pipeline9LocalWorkerPool"
import type { Pipeline9ParallelHighDensityContext, Pipeline9ParallelHighDensityNodeResult } from "./parallelWorkerTypes"
import type { FirstValidHighDensityStats, ParallelHighDensityPolicy } from "./parallelHighDensityPolicyTypes"
import type { FirstValidA13NodeResult, FirstValidNodeFrontierStats } from "./parallelHighDensityFrontierTypes"
import { isParallelHighDensityBatchEligible, PARALLEL_HIGH_DENSITY_NODE_BATCH_MAX_SIZE,
  type ParallelHighDensityBatchEntry, type ParallelHighDensityNodeBatchResult } from "./parallelHighDensityNodeBatching"

type SettledNodeResult =
  | { kind: "result"; result: Pipeline9ParallelHighDensityNodeResult }
  | { kind: "exception"; error: Error }
export type Pipeline9ParallelHighDensitySolverParams = Pipeline9HighDensitySolverParams & {
  workerPool: Pipeline9LocalWorkerPool
  highDensityPolicy?: ParallelHighDensityPolicy
  firstValidClearance?: number
  requirePhysicalCopper?: boolean
  batchTinyNodes?: boolean
}

/** Dispatch independent nodes together and commit in the serial pipeline order. */
export class Pipeline9ParallelHighDensitySolver extends Pipeline9HighDensitySolver {
  private readonly workerPool: Pipeline9LocalWorkerPool
  private launched = false
  private waitingForNode: NodeWithPortPoints | null = null
  private readonly requests = new Map<NodeWithPortPoints, Promise<void>>()
  private readonly results = new Map<NodeWithPortPoints, SettledNodeResult>()
  private readonly highDensityPolicy: ParallelHighDensityPolicy
  private readonly firstValidStats?: FirstValidHighDensityStats
  private readonly firstValidClearance: number
  private readonly requirePhysicalCopper: boolean
  private readonly frontierStats?: FirstValidNodeFrontierStats
  private readonly batchTinyNodes: boolean

  constructor({ workerPool, highDensityPolicy = "ordered", firstValidClearance = 0.1, requirePhysicalCopper, batchTinyNodes = true, ...params }: Pipeline9ParallelHighDensitySolverParams) {
    super(params)
    this.workerPool = workerPool
    this.highDensityPolicy = highDensityPolicy
    this.firstValidClearance = firstValidClearance
    this.requirePhysicalCopper = requirePhysicalCopper ?? highDensityPolicy === "first-valid"
    this.batchTinyNodes = batchTinyNodes
    if (highDensityPolicy === "first-valid") {
      this.firstValidStats = { eligiblePortfolioCount: 0, acceptedCandidateCount: 0,
        rejectedCandidateCount: 0, rejectionReasons: {}, winners: [] }
      this.stats.firstValidHighDensityStats = this.firstValidStats
      this.frontierStats = { pairedNodeCount: 0, loserCancellationSignals: 0, rejectedA13Count: 0,
        rejectionReasons: {}, winners: [], candidateWork: [] }
      this.stats.firstValidNodeFrontierStats = this.frontierStats
    }
    this.pendingEffects = []
    this.stats.parallelNodeCount = 0
    this.stats.parallelNodesCompleted = 0
    this.stats.parallelNodeBatchCount = 0
    this.stats.parallelBatchedNodeCount = 0
    this.stats.parallelNodeSingletonCount = 0
  }

  override getSolverName(): string {
    return "Pipeline9ParallelHighDensitySolver"
  }

  private launchNodes(): void {
    // Preload mutation is sequential. Its nodes retain the existing local path.
    if (this.fixedHdRoutes.length > 0) return
    const contextId = this.workerPool.createContextId()
    const context: Pipeline9ParallelHighDensityContext = {
      connectivityNetMap: this.connMap.netMap,
      connectivityIdToNetMap: this.connMap.idToNetMap,
      colorMap: this.colorMap,
      obstacles: this.obstacles,
      boardGeometry: this.boardGeometry,
      viaDiameter: this.viaDiameter,
      traceWidth: this.traceWidth,
      obstacleMargin: this.obstacleMargin,
      effort: this.effort,
      layerCount: this.layerCount,
      allowBlindAndBuriedVias: this.allowBlindAndBuriedVias,
      viaToPadClearance: this.viaToPadClearance,
      preserveTerminalPcbPortIds: this.preserveTerminalPcbPortIds,
      includeBoardObstacles: this.includeBoardObstacles,
      enableRegionalFallback: this.enableRegionalFallback,
      maxB01Rips: this.maxB01Rips,
      highDensityPolicy: this.highDensityPolicy,
      firstValidClearance: this.firstValidClearance,
      requirePhysicalCopper: this.requirePhysicalCopper,
    }
    // Longest likely jobs start first; result order remains unchanged.
    const nodes = [...this.unsolvedNodePortPoints].sort((a, b) =>
      b.portPoints.length ** 2 * b.width * b.height - a.portPoints.length ** 2 * a.width * a.height)
    this.stats.parallelNodeCount = nodes.length
    const tinyNodes: NodeWithPortPoints[] = []
    for (const node of nodes) {
      if (this.highDensityPolicy === "first-valid" && this.isCompetitiveNode(node)) {
        this.launchCompetitiveNode(node, contextId, context)
        continue
      }
      if (this.batchTinyNodes && isParallelHighDensityBatchEligible(node, context)) tinyNodes.push(node)
      else this.launchSingletonNode(node, contextId, context)
    }
    // Difficult independent jobs retain singleton ownership and start first.
    // Keep at least four waves of small jobs available for dynamic scheduling.
    const batchSize = Math.min(PARALLEL_HIGH_DENSITY_NODE_BATCH_MAX_SIZE,
      Math.max(2, Math.ceil(tinyNodes.length / (this.workerPool.workerCount * 4))))
    for (let offset = 0; offset < tinyNodes.length; offset += batchSize) {
      const batch = tinyNodes.slice(offset, offset + batchSize)
      if (batch.length === 1) this.launchSingletonNode(batch[0]!, contextId, context)
      else this.launchNodeBatch(batch, contextId, context)
    }
  }

  private launchSingletonNode(node: NodeWithPortPoints, contextId: number,
    context: Pipeline9ParallelHighDensityContext): void {
    this.stats.parallelNodeSingletonCount++
    const promise = this.workerPool.run<Pipeline9ParallelHighDensityNodeResult>({
      kind: "highDensityNode", contextId, context, nodeWithPortPoints: node,
      nodePf: this.nodePfById.get(node.capacityMeshNodeId) ?? null,
    }).then(
      (result): void => {
        this.results.set(node, { kind: "result", result })
        this.stats.parallelNodesCompleted++
      },
      (error: unknown): void => {
        this.results.set(node, { kind: "exception", error: error instanceof Error ? error : new Error(String(error)) })
      })
    this.requests.set(node, promise)
  }

  private launchNodeBatch(nodes: NodeWithPortPoints[], contextId: number,
    context: Pipeline9ParallelHighDensityContext): void {
    const entries: ParallelHighDensityBatchEntry[] = nodes.map((node) => ({ nodeWithPortPoints: node,
      nodePf: this.nodePfById.get(node.capacityMeshNodeId) ?? null }))
    this.stats.parallelNodeBatchCount++
    this.stats.parallelBatchedNodeCount += nodes.length
    const promise = this.workerPool.run<ParallelHighDensityNodeBatchResult>({
      kind: "highDensityNodeBatch", contextId, context, nodes: entries,
    }).then((batch): void => {
      for (let index = 0; index < nodes.length; index++) {
        this.results.set(nodes[index]!, { kind: "result", result: batch.results[index]!.result })
        this.stats.parallelNodesCompleted++
      }
    }, (error: unknown): void => {
      const failure = error instanceof Error ? error : new Error(String(error))
      for (const node of nodes) this.results.set(node, { kind: "exception", error: failure })
    })
    for (const node of nodes) this.requests.set(node, promise)
  }

  private isCompetitiveNode(node: NodeWithPortPoints): boolean {
    if (node.portPoints.length <= 2 || node.width <= 0 || node.height <= 0) return false
    // Reuse the ordinary solver's difficult-node classification. Without a PF,
    // reserve competition for at least three independent routes sharing a cell.
    const nodePf = this.nodePfById.get(node.capacityMeshNodeId) ?? null
    if (nodePf !== null && nodePf > 0.05) return true
    if (node.portPoints.length < 6) return false
    const roots = new Set(node.portPoints.map((port) => {
      const id = port.rootConnectionName ?? port.connectionName
      return this.connMap.getNetConnectedToId(id) ?? id
    }))
    return roots.size >= 3
  }

  private launchCompetitiveNode(node: NodeWithPortPoints, contextId: number,
    context: Pipeline9ParallelHighDensityContext): void {
    const stats = this.frontierStats
    if (!stats) throw new Error("Competitive HD frontier is missing its statistics")
    stats.pairedNodeCount++
    this.stats.parallelNodeSingletonCount++
    const started = performance.now()
    const genericCancellation = new Int32Array(new SharedArrayBuffer(4))
    const a13Cancellation = new Int32Array(new SharedArrayBuffer(4))
    let chosen = false
    let genericFailure: Pipeline9ParallelHighDensityNodeResult | undefined
    let a13Finished = false
    let resolveRequest!: () => void
    const request = new Promise<void>((resolve): void => { resolveRequest = resolve })
    this.requests.set(node, request)
    const choose = (settled: SettledNodeResult, source: "generic-native" | "validated-a13"): void => {
      if (chosen) throw new Error("Competitive HD frontier selected a node twice")
      chosen = true
      const loser = source === "generic-native" ? a13Cancellation : genericCancellation
      if (Atomics.exchange(loser, 0, 1) === 0) stats.loserCancellationSignals++
      if (settled.kind === "result" && settled.result.status === "solved") {
        stats.winners.push({ nodeId: node.capacityMeshNodeId, source, elapsedTimeMs: performance.now() - started })
        this.stats.parallelNodesCompleted++
      }
      this.results.set(node, settled)
      resolveRequest()
    }
    const recordException = (error: unknown, source: "generic-native" | "validated-a13"): void => {
      stats.candidateWork.push({ nodeId: node.capacityMeshNodeId, source, status: "exception",
        sourceStats: { error: error instanceof Error ? error.message : String(error) } })
      if (!chosen) choose({ kind: "exception", error: error instanceof Error ? error : new Error(String(error)) }, source)
    }
    const nodePf = this.nodePfById.get(node.capacityMeshNodeId) ?? null
    void this.workerPool.run<Pipeline9ParallelHighDensityNodeResult>({ kind: "highDensityNode", contextId, context,
      nodeWithPortPoints: node, nodePf, cancellationBuffer: genericCancellation.buffer as SharedArrayBuffer,
      disableIdleA13Candidate: true }).then((result): void => {
      stats.candidateWork.push({ nodeId: node.capacityMeshNodeId, source: "generic-native", status: result.status,
        iterations: result.nodeIterations, sourceStats: result.status === "exception"
          ? { ...result.nodeStats, exception: result.exception } : { ...result.nodeStats } })
      if (chosen) return
      if (result.status === "exception") {
        const error = new Error(result.exception.message)
        error.name = result.exception.name
        if (result.exception.stack) error.stack = result.exception.stack
        choose({ kind: "exception", error }, "generic-native")
        return
      }
      if (result.status === "cancelled") throw new Error("Competitive generic HD job was cancelled before a winner existed")
      if (result.status === "solved") { choose({ kind: "result", result }, "generic-native"); return }
      if (result.status !== "failed") throw new Error("Competitive generic HD job returned an unknown result")
      genericFailure = result
      if (a13Finished) choose({ kind: "result", result }, "generic-native")
    }).catch((error: unknown): void => recordException(error, "generic-native"))
    void this.workerPool.run<FirstValidA13NodeResult>({ kind: "highDensityA13Node", contextId, context,
      nodeWithPortPoints: node, nodePf, cancellationBuffer: a13Cancellation.buffer as SharedArrayBuffer }).then((result): void => {
      if (result.kind !== "highDensityA13Node") throw new Error("Competitive A13 frontier returned a different job result")
      stats.candidateWork.push({ nodeId: node.capacityMeshNodeId, source: "validated-a13", status: result.status,
        iterations: result.work.iterations, routingIterations: result.work.routingIterations,
        sourceStats: result.status === "exception"
          ? { ...result.work.sourceStats, exception: result.exception } : result.work.sourceStats })
      a13Finished = true
      if (chosen) return
      if (result.status === "exception") {
        const error = new Error(result.exception.message)
        error.name = result.exception.name
        choose({ kind: "exception", error }, "validated-a13")
        return
      }
      if (result.status === "cancelled") throw new Error("Competitive A13 job was cancelled before a winner existed")
      if (result.status === "solved") { choose({ kind: "result", result }, "validated-a13"); return }
      if (result.status === "rejected") {
        stats.rejectedA13Count++
        stats.rejectionReasons[result.reason] = (stats.rejectionReasons[result.reason] ?? 0) + 1
      } else if (result.status !== "failed") throw new Error("Competitive A13 job returned an unknown result")
      if (genericFailure) choose({ kind: "result", result: genericFailure }, "generic-native")
    }).catch((error: unknown): void => recordException(error, "validated-a13"))
  }

  protected override startRegularSolver(node: NodeWithPortPoints): void {
    const request = this.requests.get(node)
    if (!request) {
      super.startRegularSolver(node)
      return
    }
    const settled = this.results.get(node)
    if (settled) {
      this.applyNodeResult(node, settled)
      return
    }
    this.waitingForNode = node
    this.pendingEffects = [{ name: `parallel-hd:${node.capacityMeshNodeId}`, promise: request }]
  }

  private applyNodeResult(node: NodeWithPortPoints, settled: SettledNodeResult): void {
    this.requests.delete(node)
    this.results.delete(node)
    if (settled.kind === "exception") throw settled.error
    if (settled.result.status === "exception") {
      const error = new Error(settled.result.exception.message)
      error.name = settled.result.exception.name
      if (settled.result.exception.stack) error.stack = settled.result.exception.stack
      throw error
    }
    this.mergeFirstValidStats(settled.result)
    this.activeNode = node
    for (const [key, value] of Object.entries(settled.result.nodeStats)) {
      if (key === "nodeCount" || key === "solvedNodeCount" || key === "fixedObstacleCount") continue
      if (typeof this.stats[key] !== "number") throw new Error(`Pipeline9 parent statistic ${key} is not numeric`)
      this.stats[key] += value
    }
    if (settled.result.status === "failed") {
      this.error = settled.result.error
      this.failed = true
      this.activeNode = null
      return
    }
    if (settled.result.status === "cancelled") throw new Error("Pipeline9 attempted to commit a cancelled high-density node")
    this.finishActiveNode(settled.result.routes)
  }

  private mergeFirstValidStats(result: Pipeline9ParallelHighDensityNodeResult): void {
    if (this.highDensityPolicy === "ordered") {
      if (result.firstValidStats) throw new Error("Ordered HD worker returned competitive policy statistics")
      return
    }
    const aggregate = this.firstValidStats
    const nodeStats = result.firstValidStats
    if (!aggregate || !nodeStats) throw new Error("Competitive HD worker omitted its policy statistics")
    aggregate.eligiblePortfolioCount += nodeStats.eligiblePortfolioCount
    aggregate.acceptedCandidateCount += nodeStats.acceptedCandidateCount
    aggregate.rejectedCandidateCount += nodeStats.rejectedCandidateCount
    aggregate.winners.push(...nodeStats.winners)
    if (nodeStats.candidateWork) {
      aggregate.candidateWork ??= []
      aggregate.candidateWork.push(...nodeStats.candidateWork)
    }
    for (const [reason, count] of Object.entries(nodeStats.rejectionReasons)) {
      aggregate.rejectionReasons[reason] = (aggregate.rejectionReasons[reason] ?? 0) + count
    }
  }

  override _step(): void {
    if (!this.launched) {
      this.launched = true
      this.launchNodes()
    }
    if (this.waitingForNode) {
      const node = this.waitingForNode
      const settled = this.results.get(node)
      if (!settled) return
      this.waitingForNode = null
      this.pendingEffects = []
      this.applyNodeResult(node, settled)
      return
    }
    super._step()
  }
}
