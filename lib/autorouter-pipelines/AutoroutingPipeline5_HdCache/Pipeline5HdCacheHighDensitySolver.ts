import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { GraphicsObject } from "graphics-debug"
import type { CapacityMeshNodeId } from "lib/types/capacity-mesh-types"
import { mergeRouteSegments } from "lib/utils/mergeRouteSegments"
import { BaseSolver, type PendingEffect } from "../../solvers/BaseSolver"
import { CachedIntraNodeRouteSolver } from "../../solvers/HighDensitySolver/CachedIntraNodeRouteSolver"
import { IntraNodeRouteSolver } from "../../solvers/HighDensitySolver/IntraNodeSolver"
import { HyperSingleIntraNodeSolver } from "../../solvers/HyperHighDensitySolver/HyperSingleIntraNodeSolver"
import { safeTransparentize } from "../../solvers/colors"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "../../types/high-density-types"
import type { Obstacle } from "../../types/srj-types"

type HdCacheSolveResponseBody = {
  ok: boolean
  source: "cache" | "solver" | "none"
  pairCount: number
  bucketKey: string
  bucketSize: number
  kOrder?: number | null
  routes: HighDensityIntraNodeRoute[] | null
  drc: {
    ok: boolean
    issues: unknown[]
  } | null
  solverSolved?: boolean
  message?: string
}

type FailedHdCacheRequestRecord = {
  nodeId: CapacityMeshNodeId
  pairCount: number
  failedAt: string
  durationMs: number
  error: string
  url: string
  request: {
    method: "POST"
    headers: {
      "content-type": "application/json"
    }
    body: string
    bodyJson: {
      nodeWithPortPoints: NodeWithPortPoints
    }
  }
  response?: {
    status?: number
    ok?: boolean
    text?: string
    body?: HdCacheSolveResponseBody | null
  }
}

type NodeSolveMetadata = {
  node: NodeWithPortPoints
  status: "solved" | "failed"
  resolution: "remote" | "local" | "local-fallback" | "failed"
  solverType: string
  supervisorType?: string
  iterations: number | null
  pairCount: number
  routeCount: number
  nodePf: number | null
  remoteAttempt: {
    attempted: boolean
    endpoint?: string
    source?: HdCacheSolveResponseBody["source"] | "error"
    durationMs?: number
    error?: string
  }
  error?: string
}

const DEFAULT_HD_CACHE_BASE_URL = "https://hd-cache.tscircuit.com"

const getHdCacheSolveUrl = (baseUrl: string) =>
  /\/solve\/?$/.test(baseUrl)
    ? baseUrl.replace(/\/+$/, "")
    : `${baseUrl.replace(/\/+$/, "")}/solve`

const getFailedHdCacheRequestStore = () => {
  if (typeof window === "undefined") {
    return null
  }

  const failedRequestWindow = window as Window & {
    __FAILED_HD_CACHE_REQUESTS?: FailedHdCacheRequestRecord[]
  }

  if (!Array.isArray(failedRequestWindow.__FAILED_HD_CACHE_REQUESTS)) {
    failedRequestWindow.__FAILED_HD_CACHE_REQUESTS = []
  }

  return failedRequestWindow.__FAILED_HD_CACHE_REQUESTS
}

const createConnectionRootMap = (node: NodeWithPortPoints) => {
  const connectionRootMap = new Map<string, string>()

  for (const portPoint of node.portPoints) {
    if (
      portPoint.rootConnectionName &&
      !connectionRootMap.has(portPoint.connectionName)
    ) {
      connectionRootMap.set(
        portPoint.connectionName,
        portPoint.rootConnectionName,
      )
    }
  }

  return connectionRootMap
}

const normalizeRemoteRoutes = (
  node: NodeWithPortPoints,
  routes: HighDensityIntraNodeRoute[],
  defaults: {
    traceWidth: number
    viaDiameter: number
  },
): HighDensityIntraNodeRoute[] => {
  const connectionRootMap = createConnectionRootMap(node)

  return routes.map((route) => ({
    connectionName: route.connectionName,
    rootConnectionName:
      route.rootConnectionName ??
      connectionRootMap.get(route.connectionName) ??
      undefined,
    traceThickness: route.traceThickness ?? defaults.traceWidth,
    viaDiameter: route.viaDiameter ?? defaults.viaDiameter,
    route: (route.route ?? []).map((point) => ({
      x: point.x,
      y: point.y,
      z: point.z,
      ...(point.insideJumperPad ? { insideJumperPad: true } : {}),
    })),
    vias: (route.vias ?? []).map((via) => ({
      x: via.x,
      y: via.y,
    })),
    ...(route.jumpers ? { jumpers: route.jumpers } : {}),
  }))
}

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value)

const getPercentile = (sortedValues: number[], percentile: number) => {
  if (sortedValues.length === 0) {
    return null
  }

  const boundedPercentile = Math.min(Math.max(percentile, 0), 1)
  const index = (sortedValues.length - 1) * boundedPercentile
  const lowerIndex = Math.floor(index)
  const upperIndex = Math.ceil(index)
  const lowerValue = sortedValues[lowerIndex]
  const upperValue = sortedValues[upperIndex]

  if (lowerIndex === upperIndex) {
    return lowerValue
  }

  return lowerValue + (upperValue - lowerValue) * (index - lowerIndex)
}

const getNodePairCount = (node: NodeWithPortPoints) =>
  new Set(node.portPoints.map((point) => point.connectionName)).size

const shouldSolveNodeViaHdCache = (node: NodeWithPortPoints) => {
  if (getNodePairCount(node) < 3) {
    return false
  }

  if ((node.availableZ?.length ?? 0) === 1) {
    return false
  }

  return true
}

const getIntraNodeStrategyName = (
  hyperParameters: Record<string, any> | undefined,
) => {
  if (hyperParameters?.MULTI_HEAD_POLYLINE_SOLVER) {
    return "MultiHeadPolyLineIntraNodeSolver3"
  }
  if (hyperParameters?.CLOSED_FORM_SINGLE_TRANSITION) {
    return "SingleTransitionIntraNodeSolver"
  }
  if (hyperParameters?.CLOSED_FORM_TWO_TRACE_SAME_LAYER) {
    return "TwoCrossingRoutesHighDensitySolver"
  }
  if (hyperParameters?.CLOSED_FORM_TWO_TRACE_TRANSITION_CROSSING) {
    return "SingleTransitionCrossingRouteSolver"
  }
  if (hyperParameters?.HIGH_DENSITY_A01) {
    return "HighDensitySolverA01"
  }
  if (hyperParameters?.HIGH_DENSITY_A03) {
    return "HighDensitySolverA03"
  }
  return "SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
}

const getConcreteSolverTypeName = (solver: unknown): string => {
  if (solver instanceof CachedIntraNodeRouteSolver) {
    const concreteName = getIntraNodeStrategyName(solver.hyperParameters)
    return solver.cacheHit ? `${concreteName} [cached]` : concreteName
  }

  if (solver instanceof IntraNodeRouteSolver) {
    return getIntraNodeStrategyName(solver.hyperParameters)
  }

  if (
    solver &&
    typeof solver === "object" &&
    "getSolverName" in solver &&
    typeof solver.getSolverName === "function"
  ) {
    return solver.getSolverName()
  }

  const solverConstructor = (
    solver as {
      constructor?: {
        name?: string
      }
    } | null
  )?.constructor
  if (typeof solverConstructor?.name === "string") {
    return solverConstructor.name
  }

  return "unknown"
}

const getSolvedNodeSolverType = (solver: HyperSingleIntraNodeSolver) => {
  if (solver.winningSolver) {
    return getConcreteSolverTypeName(solver.winningSolver)
  }
  return getConcreteSolverTypeName(solver)
}

export class Pipeline5HdCacheHighDensitySolver extends BaseSolver {
  override getSolverName(): string {
    return "Pipeline5HdCacheHighDensitySolver"
  }

  readonly unsolvedNodePortPoints: NodeWithPortPoints[]
  readonly colorMap: Record<string, string>
  readonly connMap?: ConnectivityMap
  readonly viaDiameter: number
  readonly traceWidth: number
  readonly obstacleMargin: number
  readonly obstacles: Obstacle[]
  readonly layerCount: number
  readonly hdCacheBaseUrl: string
  readonly fetchImpl: typeof fetch
  readonly nodePfById: Map<CapacityMeshNodeId, number | null>

  routes: HighDensityIntraNodeRoute[] = []
  nodeSolveMetadataById = new Map<CapacityMeshNodeId, NodeSolveMetadata>()

  private launchedRemoteSolves = false
  private readonly solvedRoutesByNodeIndex = new Map<
    number,
    HighDensityIntraNodeRoute[]
  >()
  private readonly failedNodeResults: Array<{
    node: NodeWithPortPoints
    error: string
  }> = []
  private readonly remoteResponseMeasurements: Array<{
    nodeId: CapacityMeshNodeId
    durationMs: number
    kOrder: number | null
  }> = []

  constructor({
    nodePortPoints,
    colorMap,
    connMap,
    viaDiameter,
    traceWidth,
    obstacleMargin,
    obstacles,
    layerCount,
    nodePfById,
    hdCacheBaseUrl,
    fetchImpl,
  }: {
    nodePortPoints: NodeWithPortPoints[]
    colorMap?: Record<string, string>
    connMap?: ConnectivityMap
    viaDiameter?: number
    traceWidth?: number
    obstacleMargin?: number
    obstacles?: Obstacle[]
    layerCount?: number
    nodePfById?:
      | Map<CapacityMeshNodeId, number | null>
      | Record<string, number | null>
    hdCacheBaseUrl?: string
    fetchImpl?: typeof fetch
  }) {
    super()
    this.unsolvedNodePortPoints = nodePortPoints
    this.colorMap = colorMap ?? {}
    this.connMap = connMap
    this.viaDiameter = viaDiameter ?? 0.3
    this.traceWidth = traceWidth ?? 0.15
    this.obstacleMargin = obstacleMargin ?? 0.15
    this.obstacles = obstacles ?? []
    this.layerCount = layerCount ?? 2
    this.hdCacheBaseUrl = hdCacheBaseUrl ?? DEFAULT_HD_CACHE_BASE_URL
    this.fetchImpl = (fetchImpl ?? globalThis.fetch).bind(
      globalThis,
    ) as typeof fetch
    this.nodePfById =
      nodePfById instanceof Map
        ? new Map(nodePfById)
        : new Map(Object.entries(nodePfById ?? {}))
    this.pendingEffects = []
    this.stats = {
      localDirectNodeCount: 0,
      localSolvedNodeCount: 0,
      localFallbackNodeCount: 0,
      remoteFallbackNodeCount: 0,
      remoteRequestsStarted: 0,
      remoteRequestsCompleted: 0,
      remoteResponseSampleCount: 0,
      remoteKOrderSampleCount: 0,
      slowestRemoteResponseMs: null as number | null,
      slowestRemoteResponseNodeId: null as CapacityMeshNodeId | null,
      p50RemoteResponseMs: null as number | null,
      p50RemoteKOrder: null as number | null,
      p95RemoteKOrder: null as number | null,
      remoteSources: {} as Record<string, number>,
    }
  }

  computeProgress() {
    if (this.unsolvedNodePortPoints.length === 0) {
      return 1
    }

    return this.nodeSolveMetadataById.size / this.unsolvedNodePortPoints.length
  }

  private solveNodeLocally(
    node: NodeWithPortPoints,
    nodeIndex: number,
    opts: {
      resolution?: "local" | "local-fallback"
      remoteFailure?: string
      remoteDurationMs?: number
    } = {},
  ) {
    const localSolver = new HyperSingleIntraNodeSolver({
      nodeWithPortPoints: node,
      colorMap: this.colorMap,
      connMap: this.connMap,
      viaDiameter: this.viaDiameter,
      traceWidth: this.traceWidth,
      obstacleMargin: this.obstacleMargin,
      obstacles: this.obstacles,
      layerCount: this.layerCount,
    })

    localSolver.solve()

    if (localSolver.failed) {
      const errorMessage =
        localSolver.error ??
        `Local intra-node solver failed for ${node.capacityMeshNodeId}`
      const pairCount = getNodePairCount(node)
      this.failedNodeResults.push({
        node,
        error:
          opts.remoteFailure && opts.resolution === "local-fallback"
            ? `Remote solve failed (${opts.remoteFailure}); local fallback failed (${errorMessage})`
            : errorMessage,
      })
      this.recordNodeSolveMetadata(node, {
        status: "failed",
        resolution: "failed",
        solverType: getSolvedNodeSolverType(localSolver),
        supervisorType: localSolver.getSolverName(),
        iterations: localSolver.iterations,
        pairCount,
        routeCount: 0,
        remoteAttempt:
          opts.resolution === "local-fallback"
            ? {
                attempted: true,
                endpoint: getHdCacheSolveUrl(this.hdCacheBaseUrl),
                source: "error",
                durationMs: opts.remoteDurationMs,
                error: opts.remoteFailure ?? errorMessage,
              }
            : {
                attempted: false,
              },
        error: errorMessage,
      })
      return
    }

    this.solvedRoutesByNodeIndex.set(nodeIndex, localSolver.solvedRoutes)
    const pairCount = getNodePairCount(node)
    this.recordNodeSolveMetadata(node, {
      status: "solved",
      resolution: opts.resolution ?? "local",
      solverType: getSolvedNodeSolverType(localSolver),
      supervisorType: localSolver.getSolverName(),
      iterations: localSolver.iterations,
      pairCount,
      routeCount: localSolver.solvedRoutes.length,
      remoteAttempt:
        opts.resolution === "local-fallback"
          ? {
              attempted: true,
              endpoint: getHdCacheSolveUrl(this.hdCacheBaseUrl),
              source: "error",
              durationMs: opts.remoteDurationMs,
              error: opts.remoteFailure,
            }
          : {
              attempted: false,
            },
    })
    if (opts.resolution === "local-fallback") {
      this.stats.localFallbackNodeCount += 1
      this.stats.remoteFallbackNodeCount += 1
    } else {
      this.stats.localDirectNodeCount += 1
    }
    this.stats.localSolvedNodeCount += 1
  }

  private async solveNodeViaHdCache(
    node: NodeWithPortPoints,
    nodeIndex: number,
  ): Promise<void> {
    const requestUrl = getHdCacheSolveUrl(this.hdCacheBaseUrl)
    const requestHeaders = {
      "content-type": "application/json" as const,
    }
    const requestBodyJson = {
      nodeWithPortPoints: node,
    }
    const requestBody = JSON.stringify(requestBodyJson)
    const requestStartedAt = Date.now()
    let remoteDurationMs: number | null = null
    let responseStatus: number | undefined
    let responseOk: boolean | undefined
    let responseText: string | undefined
    let responseBody: HdCacheSolveResponseBody | null = null
    try {
      const response = await this.fetchImpl(requestUrl, {
        method: "POST",
        headers: requestHeaders,
        body: requestBody,
      })

      responseStatus = response.status
      responseOk = response.ok
      responseText = await response.text()
      remoteDurationMs = Date.now() - requestStartedAt
      responseBody = responseText
        ? (JSON.parse(responseText) as HdCacheSolveResponseBody)
        : null

      if (!response.ok) {
        throw new Error(
          responseBody?.message ??
            responseText ??
            `hd-cache request failed with status ${response.status}`,
        )
      }

      if (!responseBody?.ok || responseBody.routes === null) {
        throw new Error(
          responseBody?.message ??
            `hd-cache returned no routes for ${node.capacityMeshNodeId}`,
        )
      }

      const normalizedRoutes = normalizeRemoteRoutes(
        node,
        responseBody.routes,
        {
          traceWidth: this.traceWidth,
          viaDiameter: this.viaDiameter,
        },
      )

      this.solvedRoutesByNodeIndex.set(nodeIndex, normalizedRoutes)
      this.recordNodeSolveMetadata(node, {
        status: "solved",
        resolution: "remote",
        solverType: `hd-cache.tscircuit.com [${responseBody.source}]`,
        iterations: null,
        pairCount: getNodePairCount(node),
        routeCount: normalizedRoutes.length,
        remoteAttempt: {
          attempted: true,
          endpoint: getHdCacheSolveUrl(this.hdCacheBaseUrl),
          source: responseBody.source,
          durationMs: remoteDurationMs,
        },
      })
      this.recordRemoteSource(responseBody.source)
    } catch (error) {
      remoteDurationMs ??= Date.now() - requestStartedAt
      const errorMessage = getErrorMessage(error)
      this.recordFailedHdCacheRequest({
        nodeId: node.capacityMeshNodeId,
        pairCount: getNodePairCount(node),
        failedAt: new Date().toISOString(),
        durationMs: remoteDurationMs,
        error: errorMessage,
        url: requestUrl,
        request: {
          method: "POST",
          headers: requestHeaders,
          body: requestBody,
          bodyJson: requestBodyJson,
        },
        response:
          responseStatus !== undefined ||
          responseOk !== undefined ||
          responseText !== undefined ||
          responseBody !== null
            ? {
                status: responseStatus,
                ok: responseOk,
                text: responseText,
                body: responseBody,
              }
            : undefined,
      })
      this.recordRemoteSource("error")
      this.solveNodeLocally(node, nodeIndex, {
        resolution: "local-fallback",
        remoteFailure: errorMessage,
        remoteDurationMs,
      })
    } finally {
      this.recordRemoteResponseMetrics(
        node.capacityMeshNodeId,
        remoteDurationMs ?? Date.now() - requestStartedAt,
        isFiniteNumber(responseBody?.kOrder) ? responseBody.kOrder : null,
      )
      this.stats.remoteRequestsCompleted += 1
    }
  }

  private launchRemoteSolves() {
    const pendingEffects: PendingEffect[] = []

    this.unsolvedNodePortPoints.forEach((node, nodeIndex) => {
      if (!shouldSolveNodeViaHdCache(node)) {
        this.solveNodeLocally(node, nodeIndex)
        return
      }

      const pendingEffect: PendingEffect = {
        name: `hd-cache:${node.capacityMeshNodeId}`,
        promise: Promise.resolve(),
      }

      pendingEffect.promise = this.solveNodeViaHdCache(node, nodeIndex).finally(
        () => {
          this.pendingEffects = this.pendingEffects?.filter(
            (effect) => effect !== pendingEffect,
          )
        },
      )

      pendingEffects.push(pendingEffect)
    })

    this.pendingEffects = pendingEffects
    this.stats.remoteRequestsStarted = pendingEffects.length
  }

  private recordRemoteSource(
    source: HdCacheSolveResponseBody["source"] | "error",
  ) {
    this.stats.remoteSources[source] =
      (this.stats.remoteSources[source] ?? 0) + 1
  }

  private recordRemoteResponseMetrics(
    nodeId: CapacityMeshNodeId,
    durationMs: number,
    kOrder: number | null,
  ) {
    this.remoteResponseMeasurements.push({ nodeId, durationMs, kOrder })
    this.stats.remoteResponseSampleCount =
      this.remoteResponseMeasurements.length
    this.stats.remoteKOrderSampleCount = this.remoteResponseMeasurements.filter(
      (measurement) => measurement.kOrder !== null,
    ).length

    let slowest: { nodeId: CapacityMeshNodeId; durationMs: number } | null =
      null
    for (const measurement of this.remoteResponseMeasurements) {
      if (!slowest || measurement.durationMs > slowest.durationMs) {
        slowest = measurement
      }
    }

    this.stats.slowestRemoteResponseMs = slowest?.durationMs ?? null
    this.stats.slowestRemoteResponseNodeId = slowest?.nodeId ?? null

    const sortedDurations = this.remoteResponseMeasurements
      .map((measurement) => measurement.durationMs)
      .sort((a, b) => a - b)

    this.stats.p50RemoteResponseMs = getPercentile(sortedDurations, 0.5)

    const sortedKOrders = this.remoteResponseMeasurements
      .map((measurement) => measurement.kOrder)
      .filter((measurement): measurement is number => measurement !== null)
      .sort((a, b) => a - b)

    this.stats.p50RemoteKOrder = getPercentile(sortedKOrders, 0.5)
    this.stats.p95RemoteKOrder = getPercentile(sortedKOrders, 0.95)
  }

  private recordFailedHdCacheRequest(
    failedRequest: FailedHdCacheRequestRecord,
  ) {
    const failedRequestStore = getFailedHdCacheRequestStore()
    if (!failedRequestStore) return
    failedRequestStore.push(failedRequest)
  }

  private recordNodeSolveMetadata(
    node: NodeWithPortPoints,
    result: Omit<NodeSolveMetadata, "node" | "nodePf">,
  ) {
    this.nodeSolveMetadataById.set(node.capacityMeshNodeId, {
      ...result,
      node,
      nodePf: this.nodePfById.get(node.capacityMeshNodeId) ?? null,
    })
  }

  private ensureFailedNodeMetadata() {
    for (const failedResult of this.failedNodeResults) {
      if (
        this.nodeSolveMetadataById.has(failedResult.node.capacityMeshNodeId)
      ) {
        continue
      }

      this.recordNodeSolveMetadata(failedResult.node, {
        status: "failed",
        resolution: "failed",
        solverType: "unknown",
        iterations: null,
        pairCount: getNodePairCount(failedResult.node),
        routeCount: 0,
        remoteAttempt: {
          attempted: shouldSolveNodeViaHdCache(failedResult.node),
          source: "error",
          error: failedResult.error,
        },
        error: failedResult.error,
      })
    }
  }

  private getVisibleRoutes() {
    if (this.solved) {
      return this.routes
    }

    const visibleRoutes: HighDensityIntraNodeRoute[] = []
    for (let i = 0; i < this.unsolvedNodePortPoints.length; i++) {
      visibleRoutes.push(...(this.solvedRoutesByNodeIndex.get(i) ?? []))
    }
    return visibleRoutes
  }

  private createNodeMarkerLabel(
    capacityMeshNodeId: CapacityMeshNodeId,
    metadata: NodeSolveMetadata,
  ): string {
    return [
      "hd_node_marker",
      `node: ${capacityMeshNodeId}`,
      `status: ${metadata.status}`,
      `resolution: ${metadata.resolution}`,
      `solver: ${metadata.solverType}`,
      ...(metadata.supervisorType
        ? [`supervisor: ${metadata.supervisorType}`]
        : []),
      ...(metadata.iterations !== null
        ? [`iterations: ${metadata.iterations}`]
        : []),
      `pairCount: ${metadata.pairCount}`,
      `routes: ${metadata.routeCount}`,
      `nodePf: ${metadata.nodePf ?? "n/a"}`,
      `remoteAttempted: ${metadata.remoteAttempt.attempted ? "yes" : "no"}`,
      ...(metadata.remoteAttempt.source
        ? [`remoteSource: ${metadata.remoteAttempt.source}`]
        : []),
      ...(metadata.remoteAttempt.durationMs !== undefined
        ? [`remoteDurationMs: ${metadata.remoteAttempt.durationMs}`]
        : []),
      ...(metadata.remoteAttempt.error
        ? [`remoteError: ${metadata.remoteAttempt.error}`]
        : []),
      `portPoints: ${metadata.node.portPoints.length}`,
      ...(metadata.error ? [`error: ${metadata.error}`] : []),
    ].join("\n")
  }

  override _step() {
    if (!this.launchedRemoteSolves) {
      this.launchedRemoteSolves = true
      this.launchRemoteSolves()
      return
    }

    if ((this.pendingEffects?.length ?? 0) > 0) {
      return
    }

    if (this.failedNodeResults.length > 0) {
      this.ensureFailedNodeMetadata()
      const firstFailure = this.failedNodeResults[0]
      this.failed = true
      this.error = `Failed to solve ${this.failedNodeResults.length} nodes via hd-cache. First failure: ${firstFailure?.node.capacityMeshNodeId} (${firstFailure?.error})`
      return
    }

    this.routes = []
    for (let i = 0; i < this.unsolvedNodePortPoints.length; i++) {
      this.routes.push(...(this.solvedRoutesByNodeIndex.get(i) ?? []))
    }
    this.solved = true
  }

  override visualize(): GraphicsObject {
    const graphics: GraphicsObject = {
      lines: [],
      points: [],
      rects: [],
      circles: [],
    }

    for (const route of this.getVisibleRoutes()) {
      const mergedSegments = mergeRouteSegments(
        route.route,
        route.connectionName,
        this.colorMap[route.connectionName],
      )

      for (const segment of mergedSegments) {
        graphics.lines!.push({
          points: segment.points,
          label: segment.connectionName,
          strokeColor:
            segment.z === 0
              ? segment.color
              : safeTransparentize(segment.color, 0.75),
          layer: `z${segment.z}`,
          strokeWidth: route.traceThickness,
          strokeDash: segment.z !== 0 ? "10, 5" : undefined,
        })
      }

      for (const via of route.vias) {
        graphics.circles!.push({
          center: via,
          layer: "z0,1",
          radius: route.viaDiameter / 2,
          fill: this.colorMap[route.connectionName],
          label: `${route.connectionName} via`,
        })
      }
    }

    for (const [capacityMeshNodeId, metadata] of this.nodeSolveMetadataById) {
      const left = metadata.node.center.x - metadata.node.width / 2
      const right = metadata.node.center.x + metadata.node.width / 2
      const top = metadata.node.center.y - metadata.node.height / 2
      const bottom = metadata.node.center.y + metadata.node.height / 2
      const label = this.createNodeMarkerLabel(capacityMeshNodeId, metadata)
      const markerColor = metadata.status === "solved" ? "blue" : "red"
      const boundaryStrokeWidth = metadata.status === "solved" ? 0.03 : 0.08

      graphics.lines!.push(
        {
          points: [
            { x: left, y: top },
            { x: right, y: top },
          ],
          layer: "hd_node_boundaries",
          strokeColor: markerColor,
          strokeDash: "6, 4",
          strokeWidth: boundaryStrokeWidth,
          label,
        },
        {
          points: [
            { x: right, y: top },
            { x: right, y: bottom },
          ],
          layer: "hd_node_boundaries",
          strokeColor: markerColor,
          strokeDash: "6, 4",
          strokeWidth: boundaryStrokeWidth,
          label,
        },
        {
          points: [
            { x: right, y: bottom },
            { x: left, y: bottom },
          ],
          layer: "hd_node_boundaries",
          strokeColor: markerColor,
          strokeDash: "6, 4",
          strokeWidth: boundaryStrokeWidth,
          label,
        },
        {
          points: [
            { x: left, y: bottom },
            { x: left, y: top },
          ],
          layer: "hd_node_boundaries",
          strokeColor: markerColor,
          strokeDash: "6, 4",
          strokeWidth: boundaryStrokeWidth,
          label,
        },
      )

      if (metadata.status === "solved") {
        graphics.points!.push({
          x: metadata.node.center.x,
          y: metadata.node.center.y,
          color: markerColor,
          layer: "hd_node_markers",
          label,
        })
      } else {
        graphics.lines!.push({
          points: [
            { x: 0, y: 0 },
            {
              x: metadata.node.center.x,
              y: metadata.node.center.y,
            },
          ],
          layer: "hd_failed_node_guides",
          strokeColor: markerColor,
          strokeDash: "8, 6",
          strokeWidth: 0.05,
          label,
        })
        const rectWidth = Math.max(metadata.node.width, 1.2)
        const rectHeight = Math.max(metadata.node.height, 1.2)
        const halfRectWidth = rectWidth / 2
        const halfRectHeight = rectHeight / 2

        graphics.rects!.push({
          center: metadata.node.center,
          layer: "hd_node_markers",
          width: rectWidth,
          height: rectHeight,
          fill: "rgba(255, 0, 0, 0.3)",
          stroke: markerColor,
          label,
        })
        graphics.circles!.push({
          center: metadata.node.center,
          radius: Math.max(Math.max(rectWidth, rectHeight) * 0.6, 1.1),
          layer: "hd_node_markers",
          fill: "rgba(255, 0, 0, 0.08)",
          stroke: markerColor,
          label,
        })
        graphics.lines!.push(
          {
            points: [
              {
                x: metadata.node.center.x - halfRectWidth,
                y: metadata.node.center.y - halfRectHeight,
              },
              {
                x: metadata.node.center.x + halfRectWidth,
                y: metadata.node.center.y + halfRectHeight,
              },
            ],
            layer: "hd_node_markers",
            strokeColor: markerColor,
            strokeWidth: 0.16,
            label,
          },
          {
            points: [
              {
                x: metadata.node.center.x - halfRectWidth,
                y: metadata.node.center.y + halfRectHeight,
              },
              {
                x: metadata.node.center.x + halfRectWidth,
                y: metadata.node.center.y - halfRectHeight,
              },
            ],
            layer: "hd_node_markers",
            strokeColor: markerColor,
            strokeWidth: 0.16,
            label,
          },
        )
      }
    }

    return graphics
  }
}
