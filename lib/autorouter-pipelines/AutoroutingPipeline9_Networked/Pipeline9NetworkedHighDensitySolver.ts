import type { NodeWithPortPoints } from "../../types/high-density-types"
import type { PendingEffect } from "../../solvers/BaseSolver"
import {
  normalizePipeline9NodeRootConnectionNames,
  Pipeline9HighDensitySolver,
  type Pipeline9HighDensitySolverParams,
} from "../AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9HighDensitySolver"
import { createRegionalFallbackProblem } from "../AutoroutingPipeline9_PreloadedTraceGraph/pipeline9RegionalFallback"
import {
  DEFAULT_HD_CACHE2_SERVER_URL,
  HdCache2Client,
  type HdCache2FallbackReason,
  type HdCache2SolveResult,
} from "./HdCache2Client"
import {
  mergePipeline9ProjectedConnectivityNetMaps,
  projectPipeline9OrdinaryHighDensityInput,
  projectPipeline9RegionalHighDensityInput,
} from "./pipeline9NetworkedInputProjection"
import type { Pipeline9NetworkedHighDensityNodeInput } from "./pipeline9NetworkedTypes"
import { PIPELINE9_NETWORKED_SOLVE_POLICY } from "./pipeline9NetworkedTypes"

export { DEFAULT_HD_CACHE2_SERVER_URL } from "./HdCache2Client"

export const DEFAULT_PIPELINE9_NETWORKED_TIMEOUT_MS = 30_000

export type Pipeline9NetworkedFallbackReason =
  | HdCache2FallbackReason
  | "logical_timeout"

export type Pipeline9NetworkedHighDensitySolverParams =
  Pipeline9HighDensitySolverParams & {
    autorouterVersion: string
    hdCache2ServerUrl?: string
    hdCache2CacheVersion?: string
    requestTimeoutMs?: number
  }

type RemoteNodeRequest = {
  promise: Promise<void>
  deadlineAt: number
}

/**
 * Starts every exact-cache lookup together, then consumes each result in
 * Pipeline9's existing node order. Fixed-copper nodes are still requested
 * speculatively; their result is ignored when they reach Pipeline9's B01 path.
 */
export class Pipeline9NetworkedHighDensitySolver extends Pipeline9HighDensitySolver {
  readonly autorouterVersion: string
  readonly hdCache2ServerUrl: string
  readonly hdCache2CacheVersion?: string
  readonly requestTimeoutMs: number

  private readonly hdCache2Client: HdCache2Client
  private launchedRemoteSolves = false
  private waitingForRemoteNode: NodeWithPortPoints | null = null
  private readonly remoteRequestByNode = new Map<
    NodeWithPortPoints,
    RemoteNodeRequest
  >()
  private readonly remoteResultByNode = new Map<
    NodeWithPortPoints,
    HdCache2SolveResult
  >()
  private readonly logicallyTimedOutNodes = new Set<NodeWithPortPoints>()

  constructor({
    autorouterVersion,
    hdCache2ServerUrl,
    hdCache2CacheVersion,
    requestTimeoutMs,
    ...pipeline9Params
  }: Pipeline9NetworkedHighDensitySolverParams) {
    super(pipeline9Params)
    if (pipeline9Params.effort !== 1) {
      throw new Error(
        `Pipeline9 networked high-density routing requires effort=1, received ${pipeline9Params.effort}`,
      )
    }

    this.requestTimeoutMs =
      requestTimeoutMs ?? DEFAULT_PIPELINE9_NETWORKED_TIMEOUT_MS
    if (!Number.isFinite(this.requestTimeoutMs) || this.requestTimeoutMs <= 0) {
      throw new Error(
        `Pipeline9 network request timeout must be a positive number, received ${this.requestTimeoutMs}`,
      )
    }

    this.autorouterVersion = autorouterVersion
    this.hdCache2ServerUrl = hdCache2ServerUrl ?? DEFAULT_HD_CACHE2_SERVER_URL
    this.hdCache2CacheVersion = hdCache2CacheVersion
    this.hdCache2Client = new HdCache2Client(
      this.autorouterVersion,
      this.hdCache2ServerUrl,
      {
        cacheVersion: hdCache2CacheVersion,
      },
    )
    this.pendingEffects = []
    this.stats = {
      ...this.stats,
      remoteRequestsStarted: 0,
      remoteRequestsCompleted: 0,
      remoteBatchRequestsStarted: 0,
      remoteBatchRequestsCompleted: 0,
      remoteBatchItemsStarted: 0,
      remoteBatchBodyBytesStarted: 0,
      remoteBatchMaxBodyBytes: 0,
      remoteBatchCacheMisses: 0,
      remoteSingleRequestsStarted: 0,
      remoteBatchInvalidLines: 0,
      remoteBatchUnknownRequestIds: 0,
      remoteBatchDuplicateRequestIds: 0,
      remoteCacheHits: 0,
      remoteSolverResults: 0,
      remoteSolvedResults: 0,
      remoteFailedResults: 0,
      remoteOrdinaryResults: 0,
      remoteRegionalFallbackResults: 0,
      remoteRegionalFallbackResultsApplied: 0,
      remoteRegionalFallbackResultsDeferredToLocal: 0,
      remoteTransportFallbacks: 0,
      remoteLogicalTimeoutFallbacks: 0,
      remoteFallbackReasonCounts: {},
    }
  }

  override getSolverName(): string {
    return "Pipeline9NetworkedHighDensitySolver"
  }

  async waitForAllRemoteRequests(): Promise<void> {
    const remoteRequests = [...this.remoteRequestByNode.values()]
    if (remoteRequests.length === 0) {
      this.syncClientStats()
      return
    }
    await Promise.all(remoteRequests.map(({ promise }) => promise))
    this.syncClientStats()
  }

  private createNodeInput(
    node: NodeWithPortPoints,
  ): Pipeline9NetworkedHighDensityNodeInput {
    const nearbyBoardInput = projectPipeline9RegionalHighDensityInput({
      nodeWithPortPoints: node,
      connMap: this.connMap,
      obstacles: this.obstacles,
      obstacleMargin: this.obstacleMargin,
      traceWidth: this.traceWidth,
      viaDiameter: this.viaDiameter,
    })
    const projectedInput = projectPipeline9OrdinaryHighDensityInput({
      nodeWithPortPoints: node,
      connMap: this.connMap,
      colorMap: this.colorMap,
      // The regional projection already conservatively retains every obstacle
      // in the ordinary 8x envelope, so avoid scanning the full board twice.
      obstacles: nearbyBoardInput.obstacles,
      obstacleMargin: this.obstacleMargin,
      traceWidth: this.traceWidth,
      viaDiameter: this.viaDiameter,
    })
    return {
      solvePolicy: PIPELINE9_NETWORKED_SOLVE_POLICY,
      enableRegionalFallback: this.enableRegionalFallback,
      nodeWithPortPoints: node,
      connectivityNetMap: mergePipeline9ProjectedConnectivityNetMaps(
        projectedInput.connectivityNetMap,
        nearbyBoardInput.connectivityNetMap,
      ),
      colorMap: projectedInput.colorMap,
      viaDiameter: this.viaDiameter,
      traceWidth: this.traceWidth,
      obstacleMargin: this.obstacleMargin,
      viaToPadClearance: this.viaToPadClearance,
      effort: 1,
      obstacles: projectedInput.obstacles,
      boardObstacles: nearbyBoardInput.obstacles,
      regionalObstacles: this.enableRegionalFallback
        ? nearbyBoardInput.obstacles
        : [],
      layerCount: this.layerCount,
      nodePf: this.nodePfById.get(node.capacityMeshNodeId) ?? null,
    }
  }

  private syncClientStats(): void {
    const clientStats = this.hdCache2Client.stats
    this.stats.remoteBatchRequestsStarted = clientStats.batchRequestsStarted
    this.stats.remoteBatchRequestsCompleted = clientStats.batchRequestsCompleted
    this.stats.remoteBatchItemsStarted = clientStats.batchItemsStarted
    this.stats.remoteBatchBodyBytesStarted = clientStats.batchBodyBytesStarted
    this.stats.remoteBatchMaxBodyBytes = clientStats.batchMaxBodyBytes
    this.stats.remoteBatchCacheMisses = clientStats.batchCacheMisses
    this.stats.remoteSingleRequestsStarted = clientStats.singleRequestsStarted
    this.stats.remoteBatchInvalidLines = clientStats.batchInvalidLines
    this.stats.remoteBatchUnknownRequestIds = clientStats.batchUnknownRequestIds
    this.stats.remoteBatchDuplicateRequestIds =
      clientStats.batchDuplicateRequestIds
  }

  private recordFallbackReason(reason: Pipeline9NetworkedFallbackReason): void {
    const counts = this.stats.remoteFallbackReasonCounts as Record<
      Pipeline9NetworkedFallbackReason,
      number
    >
    counts[reason] = (counts[reason] ?? 0) + 1
  }

  private trackRemoteSolve(
    node: NodeWithPortPoints,
    remotePromise: Promise<HdCache2SolveResult>,
  ): void {
    const deadlineAt = performance.now() + this.requestTimeoutMs
    this.stats.remoteRequestsStarted += 1
    const promise = remotePromise.then((result) => {
      const logicallyTimedOut = this.logicallyTimedOutNodes.has(node)
      if (!logicallyTimedOut) this.remoteResultByNode.set(node, result)

      if (result.kind === "remote") {
        if (result.response.source === "cache") this.stats.remoteCacheHits += 1
        if (result.response.source === "solver") {
          this.stats.remoteSolverResults += 1
        }
        if (result.response.status === "solved") {
          this.stats.remoteSolvedResults += 1
        } else {
          this.stats.remoteFailedResults += 1
        }
      } else if (!logicallyTimedOut) {
        this.stats.remoteTransportFallbacks += 1
        this.recordFallbackReason(result.reason)
      }

      this.stats.remoteRequestsCompleted += 1
      this.syncClientStats()
    })
    this.remoteRequestByNode.set(node, { promise, deadlineAt })
  }

  private launchRemoteSolves(): void {
    const prepared: Array<{
      node: NodeWithPortPoints
      input: Pipeline9NetworkedHighDensityNodeInput
    }> = []
    const nodesInConsumptionOrder = [...this.unsolvedNodePortPoints].reverse()

    for (const node of nodesInConsumptionOrder) {
      try {
        prepared.push({ node, input: this.createNodeInput(node) })
      } catch (error) {
        this.trackRemoteSolve(
          node,
          Promise.resolve({
            kind: "local-fallback",
            reason: "request_serialization_error",
            error: error instanceof Error ? error.message : String(error),
          }),
        )
      }
    }

    const promises = this.hdCache2Client.solveMany(
      prepared.map(({ input }) => input),
    )
    for (const [index, promise] of promises.entries()) {
      this.trackRemoteSolve(prepared[index]!.node, promise)
    }
    this.syncClientStats()
  }

  private async waitForCurrentRemoteNode(
    node: NodeWithPortPoints,
    request: RemoteNodeRequest,
  ): Promise<void> {
    const remainingTimeoutMs = request.deadlineAt - performance.now()
    if (remainingTimeoutMs <= 0) {
      this.recordLogicalTimeout(node)
      return
    }

    let logicalTimeoutId: ReturnType<typeof setTimeout> | undefined
    const result = await Promise.race([
      request.promise.then(() => "request-settled" as const),
      new Promise<"logical-timeout">((resolve) => {
        logicalTimeoutId = setTimeout(
          () => resolve("logical-timeout"),
          remainingTimeoutMs,
        )
      }),
    ])
    if (logicalTimeoutId !== undefined) clearTimeout(logicalTimeoutId)
    if (result !== "logical-timeout") return

    this.recordLogicalTimeout(node)
  }

  private recordLogicalTimeout(node: NodeWithPortPoints): void {
    this.logicallyTimedOutNodes.add(node)
    this.stats.remoteLogicalTimeoutFallbacks += 1
    this.stats.remoteTransportFallbacks += 1
    this.recordFallbackReason("logical_timeout")
  }

  protected override startRegularSolver(node: NodeWithPortPoints): void {
    const result = this.remoteResultByNode.get(node)
    if (!result) {
      const request = this.remoteRequestByNode.get(node)
      if (request) {
        this.waitingForRemoteNode = node
        const waitPromise = this.waitForCurrentRemoteNode(node, request)
        waitPromise.then(() => {
          if (this.waitingForRemoteNode !== node) return
          this.pendingEffects = []
        })
        const pendingEffect: PendingEffect = {
          name: `hd-cache2:${node.capacityMeshNodeId}`,
          promise: waitPromise,
        }
        this.pendingEffects = [pendingEffect]
        return
      }

      super.startRegularSolver(node)
      return
    }

    this.applyRemoteResultToRegularNode(node, result)
  }

  private applyRemoteResultToRegularNode(
    node: NodeWithPortPoints,
    result: HdCache2SolveResult,
  ): void {
    if (result.kind === "local-fallback") {
      super.startRegularSolver(node)
      return
    }

    this.stats.regularNodeCount = Number(this.stats.regularNodeCount ?? 0) + 1
    this.activeNode = node
    if (result.response.solutionStage === "regional-fallback") {
      this.stats.remoteRegionalFallbackResults += 1
      if (!this.canUseNoFixedCopperRegionalResult(node)) {
        this.stats.remoteRegionalFallbackResultsDeferredToLocal += 1
        this.finishRegularSolverFailure(result.response.ordinaryFailure)
        return
      }
      this.stats.remoteRegionalFallbackResultsApplied += 1
      this.stats.fallbackNodeCount =
        Number(this.stats.fallbackNodeCount ?? 0) + 1
    } else {
      this.stats.remoteOrdinaryResults += 1
    }
    if (result.response.status === "failed") {
      this.error = result.response.error
      this.failed = true
      this.activeNode = null
      return
    }

    this.finishActiveNode(result.response.routes)
  }

  /**
   * A node may have no fixed copper on its assigned layers while the regional
   * fallback, which opens every board layer, would still observe a preloaded
   * route. Re-prove independence against the current mutation state before
   * consuming a no-fixed-copper regional result.
   */
  private canUseNoFixedCopperRegionalResult(node: NodeWithPortPoints): boolean {
    const regionalNode = {
      ...normalizePipeline9NodeRootConnectionNames(node, this.connMap),
      availableZ: Array.from({ length: this.layerCount }, (_, z) => z),
    }
    const problem = createRegionalFallbackProblem(
      regionalNode,
      this.getUpdatedFixedHdRoutes(),
    )
    return (
      problem.fixedRouteSectionsByConnectionName.size === 0 &&
      problem.fixedObstacleRoutes.length === 0
    )
  }

  override _step(): void {
    this.syncClientStats()
    if (!this.launchedRemoteSolves) {
      this.launchedRemoteSolves = true
      this.launchRemoteSolves()
    }

    if (this.waitingForRemoteNode) {
      const node = this.waitingForRemoteNode
      if (this.logicallyTimedOutNodes.has(node)) {
        this.waitingForRemoteNode = null
        this.pendingEffects = []
        super.startRegularSolver(node)
        return
      }
      const result = this.remoteResultByNode.get(node)
      if (!result) return
      this.waitingForRemoteNode = null
      this.pendingEffects = []
      this.applyRemoteResultToRegularNode(node, result)
      return
    }

    super._step()
  }
}
