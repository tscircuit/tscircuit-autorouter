import type { PendingEffect } from "../../solvers/BaseSolver"
import type {
  DatasetSample,
  HdRoute as RepairHdRoute,
} from "high-density-repair02"
import { synchronizeRouteVias } from "high-density-repair02/lib/high-density-repair-solver/functions/synchronizeRouteVias"
import {
  Pipeline4HighDensityRepairSolver,
  type Pipeline4HighDensityRepairSolverParams,
} from "../../solvers/HighDensityRepairSolver/Pipeline4HighDensityRepairSolver"
import {
  DEFAULT_HD_CACHE2_SERVER_URL,
  HdCache2Client,
  type HdCache2FallbackReason,
  type HdCache2RepairSolveResult,
} from "./HdCache2Client"
import { DEFAULT_PIPELINE9_NETWORKED_TIMEOUT_MS } from "./Pipeline9NetworkedHighDensitySolver"
import {
  PIPELINE9_NETWORKED_REPAIR_POLICY,
  type Pipeline9NetworkedHighDensityRepairInput,
} from "./pipeline9NetworkedRepairTypes"

export type Pipeline9NetworkedHighDensityRepairSolverParams =
  Pipeline4HighDensityRepairSolverParams & {
    autorouterVersion: string
    hdCache2ServerUrl?: string
    hdCache2CacheVersion?: string
    requestTimeoutMs?: number
  }

type RemoteRepairRequest = {
  promise: Promise<void>
  deadlineAt: number
}

/**
 * With boundary-diagonal repair disabled, repair02 only moves copper to fix
 * clearance conflicts. Copper on one common net can only have via-via
 * conflicts; connected pads are ignored too. Keep the existing via-free case
 * and also skip groups containing at most one via after synchronization.
 */
const getTrivialRepairRoutes = (
  sample: DatasetSample,
): RepairHdRoute[] | null => {
  const routes = sample.nodeHdRoutes
  const fixedRoutes = sample.fixedHdRoutes
  const obstacles = sample.clearanceObstacles ?? sample.adjacentObstacles
  if (!routes?.length || !fixedRoutes || !obstacles) return null
  if (!routes.every((route) => route.vias && (route.route?.length ?? 0) > 0)) {
    return null
  }
  const ownedRoutesAreViaFree = routes.every(
    (route) =>
      route.vias?.length === 0 &&
      route.route!.every(
        (point) => (point.z ?? 0) === (route.route![0].z ?? 0),
      ),
  )
  if (
    ownedRoutesAreViaFree &&
    routes.length === 1 &&
    fixedRoutes.length === 0 &&
    obstacles.length === 0
  ) {
    return routes
  }
  const commonNet = routes[0].rootConnectionName ?? routes[0].connectionName
  if (typeof commonNet !== "string" || commonNet.length === 0) return null
  const allRoutes = [...routes, ...fixedRoutes]
  if (
    !allRoutes.every(
      (route) =>
        route.connectionName === commonNet ||
        route.rootConnectionName === commonNet,
    ) ||
    !routes.every((route) =>
      obstacles.every((obstacle) =>
        obstacle.connectedTo?.some(
          (id) =>
            (Boolean(route.connectionName) && id === route.connectionName) ||
            (Boolean(route.rootConnectionName) &&
              id === route.rootConnectionName),
        ),
      ),
    )
  )
    return null
  // No owned via can conflict with fixed vias, regardless of their count.
  if (ownedRoutesAreViaFree) return routes
  const fixedViaCount = fixedRoutes.reduce(
    (count, route) => count + (route.vias?.length ?? 0),
    0,
  )
  if (
    routes.reduce((count, route) => count + route.vias!.length, fixedViaCount) >
    1
  ) {
    return null
  }
  // Leave malformed transitions to the normal repair path, preserving sample
  // consumption and failure ordering instead of throwing during dispatch.
  if (
    routes.some((route) =>
      route.route!.some((point, index) => {
        const next = route.route![index + 1]
        return (
          next !== undefined &&
          (point.z ?? 0) !== (next.z ?? 0) &&
          (point.x !== next.x || point.y !== next.y)
        )
      }),
    )
  )
    return null
  // Use the dependency's exact normalization: projected transitions can retain
  // full precision while incoming via records were rounded to 0.001 mm.
  const synchronizedRoutes = routes.map(synchronizeRouteVias)
  const viaCount = synchronizedRoutes.reduce(
    (count, route) => count + (route.vias?.length ?? 0),
    fixedViaCount,
  )
  return viaCount <= 1 ? synchronizedRoutes : null
}

/**
 * Dispatches all repair samples together. Every sample keeps the original
 * neighboring copper frozen, exactly as the local repair stage does.
 */
export class Pipeline9NetworkedHighDensityRepairSolver extends Pipeline4HighDensityRepairSolver {
  readonly autorouterVersion: string
  readonly hdCache2ServerUrl: string
  readonly hdCache2CacheVersion?: string
  readonly requestTimeoutMs: number

  private readonly hdCache2Client: HdCache2Client
  private launchedRemoteRepairs = false
  private readonly remoteRequestByIndex = new Map<number, RemoteRepairRequest>()
  private readonly remoteResultByIndex = new Map<
    number,
    HdCache2RepairSolveResult
  >()
  private readonly logicallyTimedOutIndexes = new Set<number>()
  private readonly trivialRoutesByIndex = new Map<number, RepairHdRoute[]>()

  constructor({
    autorouterVersion,
    hdCache2ServerUrl,
    hdCache2CacheVersion,
    requestTimeoutMs,
    ...repairParams
  }: Pipeline9NetworkedHighDensityRepairSolverParams) {
    super(repairParams)
    this.autorouterVersion = autorouterVersion
    this.hdCache2ServerUrl = hdCache2ServerUrl ?? DEFAULT_HD_CACHE2_SERVER_URL
    this.hdCache2CacheVersion = hdCache2CacheVersion
    this.requestTimeoutMs =
      requestTimeoutMs ?? DEFAULT_PIPELINE9_NETWORKED_TIMEOUT_MS
    if (!Number.isFinite(this.requestTimeoutMs) || this.requestTimeoutMs <= 0) {
      throw new Error(
        `Pipeline9 repair request timeout must be positive, received ${this.requestTimeoutMs}`,
      )
    }
    this.hdCache2Client = new HdCache2Client(
      autorouterVersion,
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
      remoteCacheHits: 0,
      remoteSolverResults: 0,
      remoteSolvedResults: 0,
      remoteFailedResults: 0,
      remoteRepairResultsApplied: 0,
      localTrivialRepairCount: 0,
      remoteTransportFallbacks: 0,
      remoteLogicalTimeoutFallbacks: 0,
      remoteFallbackReasonCounts: {},
    }
  }

  override getSolverName(): string {
    return "Pipeline9NetworkedHighDensityRepairSolver"
  }

  override getConstructorParams(): readonly [
    ReturnType<Pipeline4HighDensityRepairSolver["getConstructorParams"]>[0] &
      Pipeline9NetworkedHighDensityRepairSolverParams,
  ] {
    const [params] = super.getConstructorParams()
    return [
      {
        ...params,
        autorouterVersion: this.autorouterVersion,
        hdCache2ServerUrl: this.hdCache2ServerUrl,
        hdCache2CacheVersion: this.hdCache2CacheVersion,
        requestTimeoutMs: this.requestTimeoutMs,
      },
    ] as const
  }

  async waitForAllRemoteRequests(): Promise<void> {
    await Promise.all(
      [...this.remoteRequestByIndex.values()].map(({ promise }) => promise),
    )
    this.syncClientStats()
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

  private recordFallbackReason(
    reason: HdCache2FallbackReason | "logical_timeout",
  ): void {
    const counts = this.stats.remoteFallbackReasonCounts as Record<
      string,
      number
    >
    counts[reason] = (counts[reason] ?? 0) + 1
  }

  private launchRemoteRepairs(): void {
    const prepared: Array<{
      index: number
      input: Pipeline9NetworkedHighDensityRepairInput
    }> = []
    for (const [index, { sample }] of this.sampleEntries.entries()) {
      const trivialRoutes = getTrivialRepairRoutes(sample)
      if (trivialRoutes) {
        this.trivialRoutesByIndex.set(index, trivialRoutes)
        continue
      }
      prepared.push({
        index,
        input: {
          solvePolicy: PIPELINE9_NETWORKED_REPAIR_POLICY,
          sample,
          repairMargin: this.repairMargin,
        },
      })
    }
    const promises = this.hdCache2Client.solveMany(
      prepared.map(({ input }) => input),
    )
    for (const [requestIndex, remotePromise] of promises.entries()) {
      const index = prepared[requestIndex].index
      const deadlineAt = performance.now() + this.requestTimeoutMs
      this.stats.remoteRequestsStarted += 1
      const promise = remotePromise.then((result) => {
        if (!this.logicallyTimedOutIndexes.has(index)) {
          this.remoteResultByIndex.set(index, result)
        }
        if (result.kind === "remote") {
          if (result.response.source === "cache")
            this.stats.remoteCacheHits += 1
          if (result.response.source === "solver")
            this.stats.remoteSolverResults += 1
          if (result.response.status === "solved")
            this.stats.remoteSolvedResults += 1
          else this.stats.remoteFailedResults += 1
        } else if (!this.logicallyTimedOutIndexes.has(index)) {
          this.stats.remoteTransportFallbacks += 1
          this.recordFallbackReason(result.reason)
        }
        this.stats.remoteRequestsCompleted += 1
        this.syncClientStats()
      })
      this.remoteRequestByIndex.set(index, { promise, deadlineAt })
    }
    this.syncClientStats()
  }

  private finishTrivialSample(): void {
    const routes = this.trivialRoutesByIndex.get(this.activeSampleIndex)
    if (!routes) throw new Error("Trivial repair sample routes are missing")
    this.stats.localTrivialRepairCount += 1
    this.finishRepairSample(routes, {
      nodeClearanceInitialConflictCount: 0,
      nodeClearanceFinalConflictCount: 0,
      nodeClearanceCandidateCount: 0,
    })
  }

  private async waitForRepair(
    index: number,
    request: RemoteRepairRequest,
  ): Promise<void> {
    const remainingTimeoutMs = request.deadlineAt - performance.now()
    let timeoutId: ReturnType<typeof setTimeout> | undefined
    const result =
      remainingTimeoutMs <= 0
        ? "logical-timeout"
        : await Promise.race([
            request.promise.then(() => "request-settled" as const),
            new Promise<"logical-timeout">((resolve) => {
              timeoutId = setTimeout(
                () => resolve("logical-timeout"),
                remainingTimeoutMs,
              )
            }),
          ])
    if (timeoutId !== undefined) clearTimeout(timeoutId)
    if (result === "logical-timeout") {
      this.logicallyTimedOutIndexes.add(index)
      this.stats.remoteLogicalTimeoutFallbacks += 1
      this.stats.remoteTransportFallbacks += 1
      this.recordFallbackReason("logical_timeout")
    }
    if (this.activeSampleIndex === index) this.pendingEffects = []
  }

  override _step(): void {
    this.syncClientStats()
    if (!this.launchedRemoteRepairs) {
      this.launchedRemoteRepairs = true
      this.launchRemoteRepairs()
    }
    if (this.activeSubSolver || !this.sampleEntries[this.activeSampleIndex]) {
      super._step()
      return
    }
    const index = this.activeSampleIndex
    if (this.trivialRoutesByIndex.has(index)) {
      this.finishTrivialSample()
      return
    }
    if (this.logicallyTimedOutIndexes.has(index)) {
      this.pendingEffects = []
      super._step()
      return
    }
    const result = this.remoteResultByIndex.get(index)
    if (!result) {
      if ((this.pendingEffects?.length ?? 0) > 0) return
      const request = this.remoteRequestByIndex.get(index)
      if (!request)
        throw new Error(`Pipeline9 repair request ${index} is missing`)
      const effect: PendingEffect = {
        name: `hd-cache2:repair:${this.sampleEntries[index].node.capacityMeshNodeId}`,
        promise: this.waitForRepair(index, request),
      }
      this.pendingEffects = [effect]
      return
    }
    this.pendingEffects = []
    if (result.kind === "local-fallback") {
      super._step()
      return
    }
    if (result.response.status === "failed") {
      this.failed = true
      this.error = result.response.error
      return
    }
    this.stats.remoteRepairResultsApplied += 1
    this.finishRepairSample(
      result.response.repairedRoutes,
      result.response.clearanceStats,
    )
  }
}
