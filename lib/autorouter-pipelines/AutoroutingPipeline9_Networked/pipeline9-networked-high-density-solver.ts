import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "../../types/high-density-types"
import type { PendingEffect } from "../../solvers/BaseSolver"
import {
  Pipeline9HighDensitySolver,
  type Pipeline9HighDensitySolverParams,
} from "../AutoroutingPipeline9_PreloadedTraceGraph/pipeline9-high-density-solver"
import { projectPipeline9OrdinaryHighDensityInput } from "../AutoroutingPipeline9_PreloadedTraceGraph/project-pipeline9-ordinary-high-density-input"
import type {
  Pipeline9NetworkedHighDensityNodeInput,
  Pipeline9NetworkedSolveBatchItem,
  Pipeline9NetworkedSolveBatchRequest,
  Pipeline9NetworkedSolveBatchResult,
  Pipeline9NetworkedSolveRequest,
  Pipeline9NetworkedSolveResponse,
} from "./pipeline9-networked-types"

export const DEFAULT_PIPELINE9_NETWORKED_CACHE_URL =
  "https://hd-cache2.tscircuit.com"
export const DEFAULT_PIPELINE9_NETWORKED_TIMEOUT_MS = 30_000
export const DEFAULT_PIPELINE9_NETWORKED_TRANSPORT_TIMEOUT_MS = 310_000
export const DEFAULT_PIPELINE9_NETWORKED_MAX_BATCH_ITEMS = 100
export const DEFAULT_PIPELINE9_NETWORKED_MAX_BATCH_BODY_BYTES =
  1.75 * 1024 * 1024
const MAX_PIPELINE9_NETWORKED_RESPONSE_LINE_CHARACTERS = 16 * 1024 * 1024

export type Pipeline9NetworkedHighDensitySolverParams =
  Pipeline9HighDensitySolverParams & {
    autorouterVersion: string
    hdCacheBaseUrl?: string
    fetchImpl?: typeof fetch
    requestTimeoutMs?: number
    transportTimeoutMs?: number
    maxBatchItems?: number
    maxBatchBodyBytes?: number
  }

type RemoteNodeResult =
  | {
      kind: "remote"
      response: Extract<Pipeline9NetworkedSolveResponse, { ok: true }>
    }
  | {
      kind: "local-fallback"
      error: string
    }

type RemoteNodeRequest = {
  promise: Promise<void>
  resolve: () => void
  settled: boolean
}

type PreparedBatchItem = Pipeline9NetworkedSolveBatchItem & {
  node: NodeWithPortPoints
  serializedItem: string
}

type PreparedBatch = {
  body: string
  bodyBytes: number
  items: PreparedBatchItem[]
}

export type Pipeline9NetworkedFallbackReason =
  | "http_error"
  | "invalid_json"
  | "invalid_response"
  | "logical_timeout"
  | "missing_response"
  | "remote_error"
  | "request_serialization_error"
  | "response_too_large"
  | "transport_error"
  | "transport_timeout"
  | "version_mismatch"

class Pipeline9NetworkedRequestError extends Error {
  constructor(
    readonly reason: Pipeline9NetworkedFallbackReason,
    message: string,
  ) {
    super(message)
    this.name = "Pipeline9NetworkedRequestError"
  }
}

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

const CIRCUIT_JSON_METADATA_KEYS = new Set([
  "pcb_smtpad_id",
  "pcb_plated_hole_id",
  "pcb_port_id",
  "pcb_via_id",
  "source_component_name",
  "source_port_name",
])

const isValidCircuitJsonMetadata = (value: unknown): boolean => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  return Object.entries(value).every(
    ([key, metadataValue]) =>
      CIRCUIT_JSON_METADATA_KEYS.has(key) && typeof metadataValue === "string",
  )
}

const nearlyEqual = (left: number, right: number): boolean =>
  Math.abs(left - right) <= 1e-9 * Math.max(1, Math.abs(left), Math.abs(right))

const isValidRemoteRoutes = (
  value: unknown,
  input: Pipeline9NetworkedHighDensityNodeInput,
): value is HighDensityIntraNodeRoute[] => {
  if (!Array.isArray(value)) return false
  const portPointsByConnectionName = new Map<
    string,
    NodeWithPortPoints["portPoints"]
  >()
  for (const portPoint of input.nodeWithPortPoints.portPoints) {
    const portPoints =
      portPointsByConnectionName.get(portPoint.connectionName) ?? []
    portPoints.push(portPoint)
    portPointsByConnectionName.set(portPoint.connectionName, portPoints)
  }
  const isPortPointForConnection = (
    point: Record<string, unknown>,
    connectionName: string,
  ): boolean =>
    (portPointsByConnectionName.get(connectionName) ?? []).some(
      (portPoint) =>
        typeof point.x === "number" &&
        nearlyEqual(point.x, portPoint.x) &&
        typeof point.y === "number" &&
        nearlyEqual(point.y, portPoint.y) &&
        point.z === portPoint.z,
    )

  for (const routeValue of value) {
    if (!routeValue || typeof routeValue !== "object") return false
    const route = routeValue as Record<string, unknown>
    if (
      typeof route.connectionName !== "string" ||
      route.connectionName.length === 0 ||
      !portPointsByConnectionName.has(route.connectionName) ||
      typeof route.traceThickness !== "number" ||
      !Number.isFinite(route.traceThickness) ||
      route.traceThickness <= 0 ||
      (!nearlyEqual(route.traceThickness, input.traceWidth) &&
        // The A03 portfolio candidate currently emits its fixed 0.1 mm width.
        !nearlyEqual(route.traceThickness, 0.1)) ||
      typeof route.viaDiameter !== "number" ||
      !Number.isFinite(route.viaDiameter) ||
      route.viaDiameter <= 0 ||
      !nearlyEqual(route.viaDiameter, input.viaDiameter) ||
      !Array.isArray(route.route) ||
      route.route.length < 2 ||
      !Array.isArray(route.vias)
    ) {
      return false
    }
    for (const optionalString of [
      route.rootConnectionName,
      route.startPcbPortId,
      route.endPcbPortId,
      route.regionId,
    ]) {
      if (optionalString !== undefined && typeof optionalString !== "string") {
        return false
      }
    }
    for (const pointValue of route.route) {
      if (!pointValue || typeof pointValue !== "object") return false
      const point = pointValue as Record<string, unknown>
      if (
        typeof point.x !== "number" ||
        !Number.isFinite(point.x) ||
        typeof point.y !== "number" ||
        !Number.isFinite(point.y) ||
        typeof point.z !== "number" ||
        !Number.isInteger(point.z) ||
        point.z < 0 ||
        point.z >= input.layerCount
      ) {
        return false
      }
      if (
        point.traceThickness !== undefined &&
        (typeof point.traceThickness !== "number" ||
          !Number.isFinite(point.traceThickness) ||
          point.traceThickness <= 0)
      ) {
        return false
      }
      if (
        point.pcb_port_id !== undefined &&
        typeof point.pcb_port_id !== "string"
      ) {
        return false
      }
      if (
        point.insideJumperPad !== undefined &&
        typeof point.insideJumperPad !== "boolean"
      ) {
        return false
      }
      if (
        point.toNextSegmentType !== undefined &&
        point.toNextSegmentType !== "through_obstacle"
      ) {
        return false
      }
      if (
        point.toNextSegmentCircuitJsonMetadata !== undefined &&
        !isValidCircuitJsonMetadata(point.toNextSegmentCircuitJsonMetadata)
      ) {
        return false
      }
    }
    const routePoints = route.route as Record<string, unknown>[]
    if (
      !isPortPointForConnection(routePoints[0]!, route.connectionName) ||
      !isPortPointForConnection(routePoints.at(-1)!, route.connectionName)
    ) {
      return false
    }
    for (const viaValue of route.vias) {
      if (!viaValue || typeof viaValue !== "object") return false
      const via = viaValue as Record<string, unknown>
      if (
        typeof via.x !== "number" ||
        !Number.isFinite(via.x) ||
        typeof via.y !== "number" ||
        !Number.isFinite(via.y)
      ) {
        return false
      }
    }
    if (route.jumpers !== undefined) {
      if (!Array.isArray(route.jumpers)) return false
      for (const jumperValue of route.jumpers) {
        if (!jumperValue || typeof jumperValue !== "object") return false
        const jumper = jumperValue as Record<string, unknown>
        const start = jumper.start as Record<string, unknown> | undefined
        const end = jumper.end as Record<string, unknown> | undefined
        if (
          jumper.route_type !== "jumper" ||
          (jumper.footprint !== "0603" &&
            jumper.footprint !== "1206" &&
            jumper.footprint !== "1206x4_pair") ||
          !start ||
          typeof start.x !== "number" ||
          !Number.isFinite(start.x) ||
          typeof start.y !== "number" ||
          !Number.isFinite(start.y) ||
          !end ||
          typeof end.x !== "number" ||
          !Number.isFinite(end.x) ||
          typeof end.y !== "number" ||
          !Number.isFinite(end.y)
        ) {
          return false
        }
      }
    }
  }
  return true
}

export const getPipeline9NetworkedSolveUrl = (baseUrl: string): string =>
  /\/solve\/?$/.test(baseUrl)
    ? baseUrl.replace(/\/+$/, "")
    : `${baseUrl.replace(/\/+$/, "")}/solve`

export const getPipeline9NetworkedSolveBatchUrl = (
  baseUrl: string,
): string => {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "")
  if (/\/solve-batch$/.test(normalizedBaseUrl)) return normalizedBaseUrl
  if (/\/solve$/.test(normalizedBaseUrl)) {
    return normalizedBaseUrl.replace(/\/solve$/, "/solve-batch")
  }
  return `${normalizedBaseUrl}/solve-batch`
}

/**
 * Starts every exact-cache request together, then lets Pipeline9 consume the
 * results in its existing node order. Requests for fixed-copper nodes are
 * intentionally speculative and ignored when that node reaches the B01 path.
 */
export class Pipeline9NetworkedHighDensitySolver extends Pipeline9HighDensitySolver {
  readonly autorouterVersion: string
  readonly hdCacheBaseUrl: string
  readonly fetchImpl: typeof fetch
  readonly requestTimeoutMs: number
  readonly transportTimeoutMs: number
  readonly maxBatchItems: number
  readonly maxBatchBodyBytes: number

  private launchedRemoteSolves = false
  private waitingForRemoteNode: NodeWithPortPoints | null = null
  private readonly remoteRequestByNode = new Map<
    NodeWithPortPoints,
    RemoteNodeRequest
  >()
  private readonly remoteResultByNode = new Map<
    NodeWithPortPoints,
    RemoteNodeResult
  >()
  private readonly logicallyTimedOutNodes = new Set<NodeWithPortPoints>()

  constructor({
    autorouterVersion,
    hdCacheBaseUrl,
    fetchImpl,
    requestTimeoutMs,
    transportTimeoutMs,
    maxBatchItems,
    maxBatchBodyBytes,
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
    this.transportTimeoutMs =
      transportTimeoutMs ?? DEFAULT_PIPELINE9_NETWORKED_TRANSPORT_TIMEOUT_MS
    this.maxBatchItems =
      maxBatchItems ?? DEFAULT_PIPELINE9_NETWORKED_MAX_BATCH_ITEMS
    this.maxBatchBodyBytes =
      maxBatchBodyBytes ?? DEFAULT_PIPELINE9_NETWORKED_MAX_BATCH_BODY_BYTES
    if (!Number.isFinite(this.requestTimeoutMs) || this.requestTimeoutMs <= 0) {
      throw new Error(
        `Pipeline9 network request timeout must be a positive number, received ${this.requestTimeoutMs}`,
      )
    }
    if (
      !Number.isFinite(this.transportTimeoutMs) ||
      this.transportTimeoutMs < this.requestTimeoutMs
    ) {
      throw new Error(
        `Pipeline9 network transport timeout must be at least the logical request timeout (${this.requestTimeoutMs}ms), received ${this.transportTimeoutMs}`,
      )
    }
    if (
      !Number.isInteger(this.maxBatchItems) ||
      this.maxBatchItems <= 0 ||
      this.maxBatchItems > DEFAULT_PIPELINE9_NETWORKED_MAX_BATCH_ITEMS
    ) {
      throw new Error(
        `Pipeline9 network max batch items must be a positive integer no greater than ${DEFAULT_PIPELINE9_NETWORKED_MAX_BATCH_ITEMS}, received ${this.maxBatchItems}`,
      )
    }
    if (
      !Number.isInteger(this.maxBatchBodyBytes) ||
      this.maxBatchBodyBytes <= 0 ||
      this.maxBatchBodyBytes >
        DEFAULT_PIPELINE9_NETWORKED_MAX_BATCH_BODY_BYTES
    ) {
      throw new Error(
        `Pipeline9 network max batch body bytes must be a positive integer no greater than ${DEFAULT_PIPELINE9_NETWORKED_MAX_BATCH_BODY_BYTES}, received ${this.maxBatchBodyBytes}`,
      )
    }

    this.autorouterVersion = autorouterVersion
    this.hdCacheBaseUrl =
      hdCacheBaseUrl ?? DEFAULT_PIPELINE9_NETWORKED_CACHE_URL
    this.fetchImpl = (fetchImpl ?? globalThis.fetch).bind(
      globalThis,
    ) as typeof fetch
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
      remoteSingleRequestsStarted: 0,
      remoteBatchInvalidLines: 0,
      remoteBatchUnknownRequestIds: 0,
      remoteBatchDuplicateRequestIds: 0,
      remoteCacheHits: 0,
      remoteSolverResults: 0,
      remoteSolvedResults: 0,
      remoteFailedResults: 0,
      remoteTransportFallbacks: 0,
      remoteLogicalTimeoutFallbacks: 0,
      remoteFallbackReasonCounts: {},
    }
  }

  override getSolverName(): string {
    return "Pipeline9NetworkedHighDensitySolver"
  }

  private createNodeInput(
    node: NodeWithPortPoints,
  ): Pipeline9NetworkedHighDensityNodeInput {
    const projectedInput = projectPipeline9OrdinaryHighDensityInput({
      nodeWithPortPoints: node,
      connMap: this.connMap,
      colorMap: this.colorMap,
      obstacles: this.obstacles,
      obstacleMargin: this.obstacleMargin,
      traceWidth: this.traceWidth,
      viaDiameter: this.viaDiameter,
    })
    return {
      nodeWithPortPoints: node,
      connectivityNetMap: projectedInput.connectivityNetMap,
      colorMap: projectedInput.colorMap,
      viaDiameter: this.viaDiameter,
      traceWidth: this.traceWidth,
      obstacleMargin: this.obstacleMargin,
      effort: 1,
      obstacles: projectedInput.obstacles,
      layerCount: this.layerCount,
      nodePf: this.nodePfById.get(node.capacityMeshNodeId) ?? null,
    }
  }

  private parseSuccessfulResponse(
    value: unknown,
    input: Pipeline9NetworkedHighDensityNodeInput,
  ): Extract<Pipeline9NetworkedSolveResponse, { ok: true }> {
    if (!value || typeof value !== "object") {
      throw new Pipeline9NetworkedRequestError(
        "invalid_response",
        "hd-cache2 returned a non-object response",
      )
    }

    const response = value as Record<string, unknown>
    if (response.ok !== true) {
      throw new Pipeline9NetworkedRequestError(
        "remote_error",
        typeof response.message === "string"
          ? response.message
          : "hd-cache2 returned an unsuccessful response",
      )
    }
    if (response.autorouterVersion !== this.autorouterVersion) {
      throw new Pipeline9NetworkedRequestError(
        "version_mismatch",
        `hd-cache2 returned autorouter version ${String(response.autorouterVersion)}, expected ${this.autorouterVersion}`,
      )
    }
    if (response.source !== "cache" && response.source !== "solver") {
      throw new Pipeline9NetworkedRequestError(
        "invalid_response",
        "hd-cache2 returned an invalid cache source",
      )
    }
    if (
      response.status === "solved" &&
      isValidRemoteRoutes(response.routes, input)
    ) {
      return response as Extract<Pipeline9NetworkedSolveResponse, { ok: true }>
    }
    if (response.status === "failed" && typeof response.error === "string") {
      return response as Extract<Pipeline9NetworkedSolveResponse, { ok: true }>
    }

    throw new Pipeline9NetworkedRequestError(
      "invalid_response",
      "hd-cache2 returned an invalid solve result",
    )
  }

  private async fetchNodeResult(
    request: Pipeline9NetworkedSolveRequest,
  ): Promise<Extract<Pipeline9NetworkedSolveResponse, { ok: true }>> {
    const controller = new AbortController()
    let didTransportTimeout = false
    const transportTimeoutId = setTimeout(() => {
      didTransportTimeout = true
      controller.abort(
        new Error(
          `hd-cache2 transport timed out after ${this.transportTimeoutMs}ms`,
        ),
      )
    }, this.transportTimeoutMs)
    const backgroundTimer = transportTimeoutId as ReturnType<
      typeof setTimeout
    > & { unref?: () => void }
    backgroundTimer.unref?.()

    try {
      const response = await this.fetchImpl(
        getPipeline9NetworkedSolveUrl(this.hdCacheBaseUrl),
        {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json",
          },
          body: JSON.stringify(request),
          signal: controller.signal,
        },
      )
      const responseText = await response.text()
      let responseBody: unknown = null
      try {
        responseBody = responseText ? JSON.parse(responseText) : null
      } catch {
        if (!response.ok) {
          throw new Pipeline9NetworkedRequestError(
            "http_error",
            `hd-cache2 request failed with status ${response.status}`,
          )
        }
        throw new Pipeline9NetworkedRequestError(
          "invalid_json",
          `hd-cache2 returned invalid JSON with status ${response.status}`,
        )
      }
      if (!response.ok) {
        const message =
          responseBody &&
          typeof responseBody === "object" &&
          "message" in responseBody &&
            typeof responseBody.message === "string"
            ? responseBody.message
            : `hd-cache2 request failed with status ${response.status}`
        throw new Pipeline9NetworkedRequestError("http_error", message)
      }
      return this.parseSuccessfulResponse(responseBody, request.input)
    } catch (error) {
      if (error instanceof Pipeline9NetworkedRequestError) throw error
      throw new Pipeline9NetworkedRequestError(
        didTransportTimeout ? "transport_timeout" : "transport_error",
        getErrorMessage(error),
      )
    } finally {
      clearTimeout(transportTimeoutId)
    }
  }

  private recordFallbackReason(
    reason: Pipeline9NetworkedFallbackReason,
  ): void {
    const counts = this.stats.remoteFallbackReasonCounts as Record<
      Pipeline9NetworkedFallbackReason,
      number
    >
    counts[reason] = (counts[reason] ?? 0) + 1
  }

  private createRemoteNodeRequest(node: NodeWithPortPoints): RemoteNodeRequest {
    let resolve!: () => void
    const promise = new Promise<void>((resolvePromise) => {
      resolve = resolvePromise
    })
    const request: RemoteNodeRequest = { promise, resolve, settled: false }
    this.remoteRequestByNode.set(node, request)
    this.stats.remoteRequestsStarted += 1
    return request
  }

  private completeNodeWithRemoteResult(
    node: NodeWithPortPoints,
    response: Extract<Pipeline9NetworkedSolveResponse, { ok: true }>,
  ): void {
    const request = this.remoteRequestByNode.get(node)
    if (!request || request.settled) return
    request.settled = true
    if (!this.logicallyTimedOutNodes.has(node)) {
      this.remoteResultByNode.set(node, { kind: "remote", response })
    }
    if (response.source === "cache") this.stats.remoteCacheHits += 1
    if (response.source === "solver") this.stats.remoteSolverResults += 1
    if (response.status === "solved") this.stats.remoteSolvedResults += 1
    if (response.status === "failed") this.stats.remoteFailedResults += 1
    this.stats.remoteRequestsCompleted += 1
    request.resolve()
  }

  private completeNodeWithLocalFallback(
    node: NodeWithPortPoints,
    error: string,
    reason: Pipeline9NetworkedFallbackReason,
  ): void {
    const request = this.remoteRequestByNode.get(node)
    if (!request || request.settled) return
    request.settled = true
    if (!this.logicallyTimedOutNodes.has(node)) {
      this.remoteResultByNode.set(node, { kind: "local-fallback", error })
      this.stats.remoteTransportFallbacks += 1
      this.recordFallbackReason(reason)
    }
    this.stats.remoteRequestsCompleted += 1
    request.resolve()
  }

  private async solveNodeRemotely(
    node: NodeWithPortPoints,
    input: Pipeline9NetworkedHighDensityNodeInput,
  ): Promise<void> {
    try {
      const response = await this.fetchNodeResult({
        autorouterVersion: this.autorouterVersion,
        input,
      })
      this.completeNodeWithRemoteResult(node, response)
    } catch (error) {
      const reason =
        error instanceof Pipeline9NetworkedRequestError
          ? error.reason
          : "transport_error"
      this.completeNodeWithLocalFallback(node, getErrorMessage(error), reason)
    }
  }

  private handleBatchResponseLine(
    line: string,
    itemsByRequestId: ReadonlyMap<string, PreparedBatchItem>,
    responseRequestIds: Set<string>,
  ): void {
    if (line.trim().length === 0) return
    if (line.length > MAX_PIPELINE9_NETWORKED_RESPONSE_LINE_CHARACTERS) {
      throw new Pipeline9NetworkedRequestError(
        "response_too_large",
        "hd-cache2 returned an oversized batch result line",
      )
    }

    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      this.stats.remoteBatchInvalidLines += 1
      return
    }
    if (!value || typeof value !== "object") {
      this.stats.remoteBatchInvalidLines += 1
      return
    }

    const requestId = (value as Record<string, unknown>).requestId
    if (typeof requestId !== "string") {
      this.stats.remoteBatchInvalidLines += 1
      return
    }
    const item = itemsByRequestId.get(requestId)
    if (!item) {
      this.stats.remoteBatchUnknownRequestIds += 1
      return
    }
    if (responseRequestIds.has(requestId)) {
      this.stats.remoteBatchDuplicateRequestIds += 1
      return
    }
    responseRequestIds.add(requestId)

    try {
      const response = this.parseSuccessfulResponse(value, item.input)
      this.completeNodeWithRemoteResult(item.node, response)
    } catch (error) {
      const reason =
        error instanceof Pipeline9NetworkedRequestError
          ? error.reason
          : "invalid_response"
      this.stats.remoteBatchInvalidLines += 1
      this.completeNodeWithLocalFallback(
        item.node,
        getErrorMessage(error),
        reason,
      )
    }
  }

  private async readBatchResponse(
    response: Response,
    batch: PreparedBatch,
  ): Promise<void> {
    if (!response.body) {
      throw new Pipeline9NetworkedRequestError(
        "invalid_response",
        "hd-cache2 returned an empty batch response body",
      )
    }

    const itemsByRequestId = new Map(
      batch.items.map((item) => [item.requestId, item]),
    )
    const responseRequestIds = new Set<string>()
    const decoder = new TextDecoder()
    const reader = response.body.getReader()
    let buffer = ""

    while (responseRequestIds.size < batch.items.length) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      if (
        buffer.length > MAX_PIPELINE9_NETWORKED_RESPONSE_LINE_CHARACTERS &&
        !buffer.includes("\n")
      ) {
        throw new Pipeline9NetworkedRequestError(
          "response_too_large",
          "hd-cache2 returned an oversized unterminated batch result line",
        )
      }

      let newlineIndex = buffer.indexOf("\n")
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex)
        buffer = buffer.slice(newlineIndex + 1)
        this.handleBatchResponseLine(line, itemsByRequestId, responseRequestIds)
        newlineIndex = buffer.indexOf("\n")
      }
      if (!done) continue
      if (buffer.trim().length > 0) {
        this.handleBatchResponseLine(
          buffer,
          itemsByRequestId,
          responseRequestIds,
        )
      }
      break
    }

    if (responseRequestIds.size === batch.items.length) {
      await reader.cancel().catch(() => {})
      return
    }
    for (const item of batch.items) {
      if (responseRequestIds.has(item.requestId)) continue
      this.completeNodeWithLocalFallback(
        item.node,
        `hd-cache2 batch ended without result ${item.requestId}`,
        "missing_response",
      )
    }
  }

  private async solveBatchRemotely(batch: PreparedBatch): Promise<void> {
    const controller = new AbortController()
    let didTransportTimeout = false
    const transportTimeoutId = setTimeout(() => {
      didTransportTimeout = true
      controller.abort(
        new Error(
          `hd-cache2 batch transport timed out after ${this.transportTimeoutMs}ms`,
        ),
      )
    }, this.transportTimeoutMs)
    const backgroundTimer = transportTimeoutId as ReturnType<
      typeof setTimeout
    > & { unref?: () => void }
    backgroundTimer.unref?.()

    try {
      const response = await this.fetchImpl(
        getPipeline9NetworkedSolveBatchUrl(this.hdCacheBaseUrl),
        {
          method: "POST",
          headers: {
            accept: "application/x-ndjson",
            "content-type": "application/json",
          },
          body: batch.body,
          signal: controller.signal,
        },
      )
      if (!response.ok) {
        const responseText = await response.text().catch(() => "")
        let message = `hd-cache2 batch request failed with status ${response.status}`
        try {
          const responseBody = responseText ? JSON.parse(responseText) : null
          if (
            responseBody &&
            typeof responseBody === "object" &&
            "message" in responseBody &&
            typeof responseBody.message === "string"
          ) {
            message = responseBody.message
          }
        } catch {}
        throw new Pipeline9NetworkedRequestError("http_error", message)
      }
      await this.readBatchResponse(response, batch)
    } catch (error) {
      const reason =
        error instanceof Pipeline9NetworkedRequestError
          ? error.reason
          : didTransportTimeout
            ? "transport_timeout"
            : "transport_error"
      for (const item of batch.items) {
        this.completeNodeWithLocalFallback(
          item.node,
          getErrorMessage(error),
          reason,
        )
      }
    } finally {
      clearTimeout(transportTimeoutId)
      this.stats.remoteBatchRequestsCompleted += 1
    }
  }

  private prepareBatches(items: PreparedBatchItem[]): {
    batches: PreparedBatch[]
    singleItems: PreparedBatchItem[]
  } {
    const encoder = new TextEncoder()
    const prefix = `{"autorouterVersion":${JSON.stringify(this.autorouterVersion)},"items":[`
    const suffix = "]}"
    const fixedBytes = encoder.encode(prefix + suffix).byteLength
    const batches: PreparedBatch[] = []
    const singleItems: PreparedBatchItem[] = []
    let currentItems: PreparedBatchItem[] = []
    let currentBytes = fixedBytes

    const flushCurrentBatch = (): void => {
      if (currentItems.length === 0) return
      batches.push({
        body: `${prefix}${currentItems.map((item) => item.serializedItem).join(",")}${suffix}`,
        bodyBytes: currentBytes,
        items: currentItems,
      })
      currentItems = []
      currentBytes = fixedBytes
    }

    for (const item of items) {
      const itemBytes = encoder.encode(item.serializedItem).byteLength
      const separatorBytes = currentItems.length === 0 ? 0 : 1
      if (fixedBytes + itemBytes > this.maxBatchBodyBytes) {
        flushCurrentBatch()
        singleItems.push(item)
        continue
      }
      if (
        currentItems.length >= this.maxBatchItems ||
        currentBytes + separatorBytes + itemBytes >
          this.maxBatchBodyBytes
      ) {
        flushCurrentBatch()
      }
      currentItems.push(item)
      currentBytes += (currentItems.length === 1 ? 0 : 1) + itemBytes
    }
    flushCurrentBatch()
    return { batches, singleItems }
  }

  private launchRemoteSolves(): void {
    const preparedItems: PreparedBatchItem[] = []
    const nodesInConsumptionOrder = [...this.unsolvedNodePortPoints].reverse()
    for (const [nodeIndex, node] of nodesInConsumptionOrder.entries()) {
      this.createRemoteNodeRequest(node)
      try {
        const input = this.createNodeInput(node)
        const requestId = String(nodeIndex)
        const serializedItem = JSON.stringify({ requestId, input })
        preparedItems.push({ requestId, input, node, serializedItem })
      } catch (error) {
        this.completeNodeWithLocalFallback(
          node,
          getErrorMessage(error),
          "request_serialization_error",
        )
      }
    }

    const { batches, singleItems } = this.prepareBatches(preparedItems)
    for (const batch of batches) {
      this.stats.remoteBatchRequestsStarted += 1
      this.stats.remoteBatchItemsStarted += batch.items.length
      this.stats.remoteBatchBodyBytesStarted += batch.bodyBytes
      this.stats.remoteBatchMaxBodyBytes = Math.max(
        this.stats.remoteBatchMaxBodyBytes,
        batch.bodyBytes,
      )
      void this.solveBatchRemotely(batch)
    }
    for (const item of singleItems) {
      this.stats.remoteSingleRequestsStarted += 1
      void this.solveNodeRemotely(item.node, item.input)
    }
  }

  private async waitForCurrentRemoteNode(
    node: NodeWithPortPoints,
    requestPromise: Promise<void>,
  ): Promise<void> {
    let logicalTimeoutId: ReturnType<typeof setTimeout> | undefined
    const result = await Promise.race([
      requestPromise.then(() => "request-settled" as const),
      new Promise<"logical-timeout">((resolve) => {
        logicalTimeoutId = setTimeout(
          () => resolve("logical-timeout"),
          this.requestTimeoutMs,
        )
      }),
    ])
    if (logicalTimeoutId !== undefined) clearTimeout(logicalTimeoutId)
    if (result !== "logical-timeout") return

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
        const waitPromise = this.waitForCurrentRemoteNode(node, request.promise)
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
    result: RemoteNodeResult,
  ): void {
    if (result.kind === "local-fallback") {
      super.startRegularSolver(node)
      return
    }

    this.stats.regularNodeCount = Number(this.stats.regularNodeCount ?? 0) + 1
    this.activeNode = node
    if (result.response.status === "failed") {
      this.finishRegularSolverFailure(result.response.error)
      return
    }

    this.finishActiveNode(result.response.routes)
  }

  override _step(): void {
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
