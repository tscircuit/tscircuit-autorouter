import {
  checkDifferentNetViaSpacing,
  checkEachPcbTraceNonOverlapping,
  checkPadTraceClearance,
  checkPcbTracesOutOfBoard,
  checkSameNetViaSpacing,
  checkTracesAreContiguous,
  checkViaTraceClearance,
} from "@tscircuit/checks"
import type {
  AnyCircuitElement,
  PcbPadTraceClearanceError,
  PcbTraceError,
  PcbViaClearanceError,
  PcbViaTraceClearanceError,
} from "circuit-json"
import {
  type ConnectivityMap,
  getFullConnectivityMapFromCircuitJson,
} from "circuit-json-to-connectivity-map"
import { Point } from "graphics-debug"
import { createPreparedDrcConnectivityMap } from "./utils/createPreparedDrcConnectivityMap"
import { createPreparedViaTraceClearanceChecker } from "./utils/createPreparedViaTraceClearanceChecker"

type CircuitJson = AnyCircuitElement[]
type CircuitJsonElement = CircuitJson[number]
type PcbViaWithTraceId = CircuitJsonElement & {
  type: "pcb_via"
  pcb_via_id: string
  pcb_trace_id: string
}

type DrcError =
  | PcbTraceError
  | PcbViaTraceClearanceError
  | PcbPadTraceClearanceError
  | PcbViaClearanceError

type DrcErrorWithCenter = DrcError & { center?: Point }

type LocationAwareDrcError = DrcError & { center: Point }

export const MIN_VIA_TO_VIA_CLEARANCE = 0.1
export const PREFERRED_VIA_TO_VIA_CLEARANCE = 0.2

export interface GetDrcErrorsResult {
  errors: DrcError[]
  errorsWithCenters: DrcErrorWithCenter[]
  locationAwareErrors: LocationAwareDrcError[]
}

export interface GetDrcErrorsOptions {
  viaClearance?: number
  traceClearance?: number
  includeTraceContinuity?: boolean
  includeTypedTraceClearance?: boolean
  includeBoardEdge?: boolean
}

export type PreparedGetDrcErrorsStats = {
  viaSpacingEvaluationCount: number
  viaSpacingCacheHitCount: number
  connectivityConstructionCount: number
  connectivityCacheHitCount: number
  connectivityPreparationTimeMs: number
  traceOverlapCheckTimeMs: number
  viaTraceCheckTimeMs: number
  padTraceCheckTimeMs: number
  viaSpacingCheckTimeMs: number
  viaTracePartitionEvaluationCount: number
  viaTracePartitionAppliedEvaluationCount: number
  viaTracePartitionNativeInvocationCount: number
  viaTracePartitionTotalViaTracePairCount: number
  viaTracePartitionSelectedViaTracePairCount: number
  viaTracePartitionTotalViaSegmentPairCount: number
  viaTracePartitionSelectedViaSegmentPairCount: number
}

export type PreparedGetDrcErrors = {
  (circuitJson: CircuitJson, options?: GetDrcErrorsOptions): GetDrcErrorsResult
  getStats: () => Readonly<PreparedGetDrcErrorsStats>
}

type ViaSpacingEvaluator = (
  circuitJson: CircuitJson,
  connMap: ConnectivityMap,
  viaClearance: number,
) => PcbViaClearanceError[]

const getDrcViaTraceConnections = (
  circuitJson: CircuitJson,
): Array<[string, string]> => {
  return circuitJson
    .filter(
      (element): element is PcbViaWithTraceId =>
        element.type === "pcb_via" && typeof element.pcb_trace_id === "string",
    )
    .map((via): [string, string] => [via.pcb_via_id, via.pcb_trace_id])
}

const createDrcConnectivityMap = (
  circuitJson: CircuitJson,
): ConnectivityMap => {
  const connMap = getFullConnectivityMapFromCircuitJson(circuitJson)
  connMap.addConnections(getDrcViaTraceConnections(circuitJson))
  return connMap
}

const evaluateOfficialViaSpacing: ViaSpacingEvaluator = (
  circuitJson,
  connMap,
  viaClearance,
): PcbViaClearanceError[] => [
  ...checkSameNetViaSpacing(circuitJson, {
    connMap,
    minClearance: viaClearance,
  }),
  ...checkDifferentNetViaSpacing(circuitJson, {
    connMap,
    minClearance: viaClearance,
  }),
]

const getDrcErrorsWithViaSpacingEvaluator = (
  circuitJson: CircuitJson,
  options: GetDrcErrorsOptions,
  connMap: ConnectivityMap,
  evaluateViaSpacing: ViaSpacingEvaluator,
  evaluateViaTraceClearance: typeof checkViaTraceClearance,
  stats?: PreparedGetDrcErrorsStats,
): GetDrcErrorsResult => {
  const viaClearance = Math.max(
    options.viaClearance ?? MIN_VIA_TO_VIA_CLEARANCE,
    MIN_VIA_TO_VIA_CLEARANCE,
  )
  const traceOverlapStartedAt = stats ? performance.now() : 0
  const traceErrors = checkEachPcbTraceNonOverlapping(circuitJson, {
    connMap,
    minClearance: options.traceClearance,
  })
  if (stats) {
    stats.traceOverlapCheckTimeMs += performance.now() - traceOverlapStartedAt
  }
  const includeTypedTraceClearance =
    options.includeTypedTraceClearance !== false
  const viaTraceStartedAt = stats ? performance.now() : 0
  const viaTraceErrors = includeTypedTraceClearance
    ? evaluateViaTraceClearance(circuitJson, {
        connMap,
        minClearance: options.traceClearance,
      })
    : []
  if (stats) {
    stats.viaTraceCheckTimeMs += performance.now() - viaTraceStartedAt
  }
  const padTraceStartedAt = stats ? performance.now() : 0
  const padTraceErrors = includeTypedTraceClearance
    ? checkPadTraceClearance(circuitJson, {
        connMap,
        minClearance: options.traceClearance,
      })
    : []
  if (stats) {
    stats.padTraceCheckTimeMs += performance.now() - padTraceStartedAt
  }
  const viaSpacingStartedAt = stats ? performance.now() : 0
  const viaErrors = evaluateViaSpacing(circuitJson, connMap, viaClearance)
  if (stats) {
    stats.viaSpacingCheckTimeMs += performance.now() - viaSpacingStartedAt
  }

  const errors: DrcError[] = [
    ...traceErrors,
    ...(options.includeBoardEdge === false
      ? []
      : checkPcbTracesOutOfBoard(circuitJson)),
    ...(options.includeTraceContinuity === false
      ? []
      : checkTracesAreContiguous(circuitJson)),
    ...viaTraceErrors,
    ...padTraceErrors,
    ...viaErrors,
  ]

  const vias = circuitJson.filter(
    (
      element,
    ): element is CircuitJsonElement & {
      type: "pcb_via"
      pcb_via_id: string
      x: number
      y: number
    } => element.type === "pcb_via",
  )

  const viasById = new Map(vias.map((via) => [via.pcb_via_id, via]))

  const errorsWithCenters = errors.map((error) => {
    if (
      error.type === "pcb_via_trace_clearance_error" &&
      typeof error.pcb_via_id === "string"
    ) {
      const via = viasById.get(error.pcb_via_id)

      if (via) {
        return {
          ...error,
          center: { x: via.x, y: via.y },
        }
      }
    }

    if ("center" in error && error.center) {
      return error as DrcErrorWithCenter
    }

    if ("pcb_center" in error && error.pcb_center) {
      return {
        ...error,
        center: error.pcb_center,
      }
    }

    if ("pcb_via_ids" in error && Array.isArray(error.pcb_via_ids)) {
      const [viaAId, viaBId] = error.pcb_via_ids
      const viaA = viasById.get(viaAId)
      const viaB = viasById.get(viaBId)

      if (viaA && viaB) {
        return {
          ...error,
          center: {
            x: (viaA.x + viaB.x) / 2,
            y: (viaA.y + viaB.y) / 2,
          },
        }
      }
    }

    if (
      "pcb_error_id" in error &&
      typeof error.pcb_error_id === "string" &&
      (error.pcb_error_id.startsWith("same_net_vias_close_") ||
        error.pcb_error_id.startsWith("different_net_vias_close_"))
    ) {
      const viaIds = error.pcb_error_id
        .replace("same_net_vias_close_", "")
        .replace("different_net_vias_close_", "")
        .split("_")
        .filter(Boolean)

      if (viaIds.length === 2) {
        const viaA = viasById.get(viaIds[0])
        const viaB = viasById.get(viaIds[1])

        if (viaA && viaB) {
          return {
            ...error,
            center: {
              x: (viaA.x + viaB.x) / 2,
              y: (viaA.y + viaB.y) / 2,
            },
          }
        }
      }
    }

    return error
  }) as DrcErrorWithCenter[]

  const locationAwareErrors = errorsWithCenters.filter(
    (error): error is LocationAwareDrcError => Boolean(error.center),
  )

  return {
    errors,
    errorsWithCenters,
    locationAwareErrors,
  }
}

const getViaSpacingCacheKey = (
  circuitJson: CircuitJson,
  connMap: ConnectivityMap,
  viaClearance: number,
): string => {
  const nameRelevantCircuitJson = circuitJson.map((element): unknown => {
    if (element.type !== "pcb_trace") return element
    // A preceding trace can shadow an opaque via id during readable-name
    // lookup. Its name uses these ordered port references, not wire geometry.
    // Keep all other metadata and the complete element order in the key.
    const connectedPcbPortIds = element.route
      .flatMap((point) => [
        "start_pcb_port_id" in point ? point.start_pcb_port_id : undefined,
        "end_pcb_port_id" in point ? point.end_pcb_port_id : undefined,
      ])
      .filter(Boolean)
    return { ...element, route: connectedPcbPortIds }
  })
  return JSON.stringify(
    {
      circuitJson: nameRelevantCircuitJson,
      // Net labels themselves participate in areIdsConnected; preserving only
      // canonical groups would not preserve arbitrary colliding opaque ids.
      idToNetMap: connMap.idToNetMap,
      viaClearance,
    },
    (_key: string, value: unknown): unknown => {
      // Tag both numbers and existing strings, so non-finite values and -0
      // cannot collide with JSON null, another number, or a literal string.
      if (typeof value === "number") {
        return `number:${Object.is(value, -0) ? "-0" : String(value)}`
      }
      if (typeof value === "string") return `string:${value}`
      return value
    },
  )
}

/** Prepares exact dependencies while retaining the native official check order. */
export const createPreparedGetDrcErrors = (): PreparedGetDrcErrors => {
  let cachedViaSpacing:
    | { key: string; errors: PcbViaClearanceError[] }
    | undefined
  const stats: PreparedGetDrcErrorsStats = {
    viaSpacingEvaluationCount: 0,
    viaSpacingCacheHitCount: 0,
    connectivityConstructionCount: 0,
    connectivityCacheHitCount: 0,
    connectivityPreparationTimeMs: 0,
    traceOverlapCheckTimeMs: 0,
    viaTraceCheckTimeMs: 0,
    padTraceCheckTimeMs: 0,
    viaSpacingCheckTimeMs: 0,
    viaTracePartitionEvaluationCount: 0,
    viaTracePartitionAppliedEvaluationCount: 0,
    viaTracePartitionNativeInvocationCount: 0,
    viaTracePartitionTotalViaTracePairCount: 0,
    viaTracePartitionSelectedViaTracePairCount: 0,
    viaTracePartitionTotalViaSegmentPairCount: 0,
    viaTracePartitionSelectedViaSegmentPairCount: 0,
  }
  const prepareConnectivityMap = createPreparedDrcConnectivityMap()
  const evaluateViaTraceClearance = createPreparedViaTraceClearanceChecker()
  const evaluateViaSpacing: ViaSpacingEvaluator = (
    circuitJson,
    connMap,
    viaClearance,
  ): PcbViaClearanceError[] => {
    // This runs at the original position of the spacing checks, after the
    // overlap checker has inferred any missing endpoint port identities.
    const key = getViaSpacingCacheKey(circuitJson, connMap, viaClearance)
    if (cachedViaSpacing?.key === key) {
      stats.viaSpacingCacheHitCount++
      return structuredClone(cachedViaSpacing.errors)
    }
    const errors = evaluateOfficialViaSpacing(
      circuitJson,
      connMap,
      viaClearance,
    )
    stats.viaSpacingEvaluationCount++
    // Results expose mutable arrays and centers. Neither this result nor a
    // future cache hit may allow consumers to mutate the retained raw errors.
    cachedViaSpacing = { key, errors: structuredClone(errors) }
    return errors
  }
  return Object.assign(
    (
      circuitJson: CircuitJson,
      options: GetDrcErrorsOptions = {},
    ): GetDrcErrorsResult => {
      const connectivityStartedAt = performance.now()
      const connMap = prepareConnectivityMap(
        circuitJson,
        getDrcViaTraceConnections(circuitJson),
      )
      stats.connectivityPreparationTimeMs +=
        performance.now() - connectivityStartedAt
      const connectivityStats = prepareConnectivityMap.getStats()
      stats.connectivityConstructionCount = connectivityStats.constructionCount
      stats.connectivityCacheHitCount = connectivityStats.cacheHitCount
      return getDrcErrorsWithViaSpacingEvaluator(
        circuitJson,
        options,
        connMap,
        evaluateViaSpacing,
        evaluateViaTraceClearance,
        stats,
      )
    },
    {
      getStats: (): Readonly<PreparedGetDrcErrorsStats> => {
        const viaTraceStats = evaluateViaTraceClearance.getStats()
        return {
          ...stats,
          viaTracePartitionEvaluationCount: viaTraceStats.evaluationCount,
          viaTracePartitionAppliedEvaluationCount:
            viaTraceStats.partitionedEvaluationCount,
          viaTracePartitionNativeInvocationCount:
            viaTraceStats.nativeInvocationCount,
          viaTracePartitionTotalViaTracePairCount:
            viaTraceStats.totalViaTracePairCount,
          viaTracePartitionSelectedViaTracePairCount:
            viaTraceStats.selectedViaTracePairCount,
          viaTracePartitionTotalViaSegmentPairCount:
            viaTraceStats.totalViaSegmentPairCount,
          viaTracePartitionSelectedViaSegmentPairCount:
            viaTraceStats.selectedViaSegmentPairCount,
        }
      },
    },
  )
}

/** One-off callers retain direct native checks and input-mutation rules. */
export const getDrcErrors = (
  circuitJson: CircuitJson,
  options: GetDrcErrorsOptions = {},
): GetDrcErrorsResult =>
  getDrcErrorsWithViaSpacingEvaluator(
    circuitJson,
    options,
    createDrcConnectivityMap(circuitJson),
    evaluateOfficialViaSpacing,
    checkViaTraceClearance,
  )
