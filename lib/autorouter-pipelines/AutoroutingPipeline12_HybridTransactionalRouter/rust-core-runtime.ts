import type {
  HybridCoreRoutePoint,
  HybridCoreSearchRequest,
  HybridCoreSearchResponse,
  HybridCoreWorkCounters,
  HybridRoutingCoreRuntime,
} from "./rust-core-protocol"
import { HYBRID_ROUTING_CORE_PROTOCOL_VERSION } from "./rust-core-protocol"

export type HybridRoutingCoreJsonExecutor = (inputJson: string) => string

export function createHybridRoutingCoreRuntime({
  target,
  executeJson,
}: {
  target: HybridRoutingCoreRuntime["target"]
  executeJson: HybridRoutingCoreJsonExecutor
}): HybridRoutingCoreRuntime {
  return Object.freeze({
    target,
    async execute(
      request: HybridCoreSearchRequest,
    ): Promise<HybridCoreSearchResponse> {
      let responseJson: string
      try {
        responseJson = executeJson(JSON.stringify(request))
      } catch (error) {
        throw new Error(
          `${target} hybrid routing core execution failed: ${getErrorMessage(error)}`,
        )
      }
      return parseHybridCoreResponse({
        responseJson,
        expectedRegionId: request.regionId,
      })
    },
  })
}

function parseHybridCoreResponse({
  responseJson,
  expectedRegionId,
}: {
  responseJson: string
  expectedRegionId: string
}): HybridCoreSearchResponse {
  let value: unknown
  try {
    value = JSON.parse(responseJson)
  } catch (error) {
    throw new Error(
      `hybrid routing core returned invalid JSON: ${getErrorMessage(error)}`,
    )
  }
  if (!isRecord(value)) {
    throw new Error("hybrid routing core response must be an object")
  }
  if (value.protocolVersion !== HYBRID_ROUTING_CORE_PROTOCOL_VERSION) {
    throw new Error(
      `hybrid routing core response protocol version ${String(value.protocolVersion)} is incompatible`,
    )
  }
  if (value.regionId !== expectedRegionId) {
    throw new Error(
      `hybrid routing core response region ${String(value.regionId)} does not match ${expectedRegionId}`,
    )
  }
  const work = parseWorkCounters(value.work)
  if (value.status === "failed") {
    if (
      (value.code !== "search_budget_exhausted" &&
        value.code !== "no_legal_path") ||
      typeof value.message !== "string"
    ) {
      throw new Error("hybrid routing core failed response is malformed")
    }
    return Object.freeze({
      status: "failed",
      protocolVersion: HYBRID_ROUTING_CORE_PROTOCOL_VERSION,
      regionId: expectedRegionId,
      code: value.code,
      message: value.message,
      work,
    })
  }
  if (
    value.status !== "solved" ||
    !Array.isArray(value.route) ||
    !Array.isArray(value.vias) ||
    !isRecord(value.cost)
  ) {
    throw new Error("hybrid routing core solved response is malformed")
  }
  const route = value.route.map(parseRoutePoint)
  const vias = value.vias.map((via) => {
    if (
      !isRecord(via) ||
      !isFiniteNumber(via.x) ||
      !isFiniteNumber(via.y) ||
      typeof via.fromLayer !== "string" ||
      typeof via.toLayer !== "string"
    ) {
      throw new Error("hybrid routing core returned a malformed via")
    }
    return Object.freeze({
      x: via.x,
      y: via.y,
      fromLayer: via.fromLayer,
      toLayer: via.toLayer,
    })
  })
  if (
    !isNonnegativeInteger(value.cost.viaCount) ||
    !isFiniteNonnegative(value.cost.totalLengthMm) ||
    !isNonnegativeInteger(value.cost.bendCount) ||
    value.cost.viaCount !== vias.length
  ) {
    throw new Error("hybrid routing core returned a malformed candidate cost")
  }
  return Object.freeze({
    status: "solved",
    protocolVersion: HYBRID_ROUTING_CORE_PROTOCOL_VERSION,
    regionId: expectedRegionId,
    route: Object.freeze(route),
    vias: Object.freeze(vias),
    cost: Object.freeze({
      viaCount: value.cost.viaCount,
      totalLengthMm: value.cost.totalLengthMm,
      bendCount: value.cost.bendCount,
    }),
    work,
  })
}

function parseRoutePoint(value: unknown): HybridCoreRoutePoint {
  if (
    !isRecord(value) ||
    !isFiniteNumber(value.x) ||
    !isFiniteNumber(value.y) ||
    typeof value.layer !== "string"
  ) {
    throw new Error("hybrid routing core returned a malformed route point")
  }
  return Object.freeze({ x: value.x, y: value.y, layer: value.layer })
}

function parseWorkCounters(value: unknown): HybridCoreWorkCounters {
  if (
    !isRecord(value) ||
    !isNonnegativeInteger(value.searchExpansions) ||
    !isNonnegativeInteger(value.spatialIndexQueries) ||
    !isNonnegativeInteger(value.geometryPredicateCalls) ||
    !isNonnegativeInteger(value.generatedNeighbors) ||
    !isNonnegativeInteger(value.peakOpenSetSize)
  ) {
    throw new Error("hybrid routing core returned malformed work counters")
  }
  return Object.freeze({
    searchExpansions: value.searchExpansions,
    spatialIndexQueries: value.spatialIndexQueries,
    geometryPredicateCalls: value.geometryPredicateCalls,
    generatedNeighbors: value.generatedNeighbors,
    peakOpenSetSize: value.peakOpenSetSize,
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function isFiniteNonnegative(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
