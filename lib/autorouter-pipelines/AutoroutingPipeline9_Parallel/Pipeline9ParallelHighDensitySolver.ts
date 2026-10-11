import type { NodeWithPortPoints } from "../../types/high-density-types"
import { Pipeline9HighDensitySolver, type Pipeline9HighDensitySolverParams } from "../AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { Pipeline9LocalWorkerPool } from "./Pipeline9LocalWorkerPool"
import type { Pipeline9ParallelHighDensityContext, Pipeline9ParallelHighDensityNodeResult } from "./parallelWorkerTypes"

type SettledNodeResult =
  | { kind: "result"; result: Pipeline9ParallelHighDensityNodeResult }
  | { kind: "exception"; error: Error }
export type Pipeline9ParallelHighDensitySolverParams = Pipeline9HighDensitySolverParams & {
  workerPool: Pipeline9LocalWorkerPool
}

/** Dispatch independent nodes together and commit in the serial pipeline order. */
export class Pipeline9ParallelHighDensitySolver extends Pipeline9HighDensitySolver {
  private readonly workerPool: Pipeline9LocalWorkerPool
  private launched = false
  private waitingForNode: NodeWithPortPoints | null = null
  private readonly requests = new Map<NodeWithPortPoints, Promise<void>>()
  private readonly results = new Map<NodeWithPortPoints, SettledNodeResult>()

  constructor({ workerPool, ...params }: Pipeline9ParallelHighDensitySolverParams) {
    super(params)
    this.workerPool = workerPool
    this.pendingEffects = []
    this.stats.parallelNodeCount = 0
    this.stats.parallelNodesCompleted = 0
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
    }
    // Longest likely jobs start first; result order remains unchanged.
    const nodes = [...this.unsolvedNodePortPoints].sort((a, b) =>
      b.portPoints.length ** 2 * b.width * b.height - a.portPoints.length ** 2 * a.width * a.height)
    this.stats.parallelNodeCount = nodes.length
    for (const node of nodes) {
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
    this.finishActiveNode(settled.result.routes)
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
