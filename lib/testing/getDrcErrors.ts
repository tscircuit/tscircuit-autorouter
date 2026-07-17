import {
  checkDifferentNetViaSpacing,
  checkEachPcbTraceNonOverlapping,
  checkPadTraceClearance,
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

type CircuitJson = AnyCircuitElement[]
type CircuitJsonElement = CircuitJson[number]
type PcbViaWithTraceId = CircuitJsonElement & {
  type: "pcb_via"
  pcb_via_id: string
  pcb_trace_id: string
}

type BaseDrcError =
  | PcbTraceError
  | PcbViaTraceClearanceError
  | PcbPadTraceClearanceError
  | PcbViaClearanceError

type DrcError = BaseDrcError & {
  pcb_trace_ids?: [string, string]
}

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
}

const createDrcConnectivityMap = (
  circuitJson: CircuitJson,
): ConnectivityMap => {
  const connMap = getFullConnectivityMapFromCircuitJson(circuitJson)
  const viaTraceConnections = circuitJson
    .filter(
      (element): element is PcbViaWithTraceId =>
        element.type === "pcb_via" && typeof element.pcb_trace_id === "string",
    )
    .map((via) => [via.pcb_via_id, via.pcb_trace_id])

  connMap.addConnections(viaTraceConnections)
  return connMap
}

const addTracePairIds = (
  error: PcbTraceError,
  pcbTraceIds: readonly string[],
): DrcError => {
  const primaryTraceId = error.pcb_trace_id
  const errorId = error.pcb_trace_error_id
  if (typeof primaryTraceId !== "string" || typeof errorId !== "string") {
    return error
  }

  const matchingOtherTraceIds = pcbTraceIds.filter(
    (candidateTraceId) =>
      candidateTraceId !== primaryTraceId &&
      (errorId === `overlap_${primaryTraceId}_${candidateTraceId}` ||
        errorId === `overlap_${candidateTraceId}_${primaryTraceId}`),
  )
  if (matchingOtherTraceIds.length > 1) {
    throw new Error(`Ambiguous trace pair metadata for DRC error "${errorId}"`)
  }
  if (matchingOtherTraceIds.length === 0) return error

  return {
    ...error,
    pcb_trace_ids: [primaryTraceId, matchingOtherTraceIds[0]!],
  }
}

export const getDrcErrors = (
  circuitJson: CircuitJson,
  options: GetDrcErrorsOptions = {},
): GetDrcErrorsResult => {
  const connMap = createDrcConnectivityMap(circuitJson)
  const viaClearance = Math.max(
    options.viaClearance ?? MIN_VIA_TO_VIA_CLEARANCE,
    MIN_VIA_TO_VIA_CLEARANCE,
  )
  const pcbTraceIds = circuitJson
    .filter(
      (
        element,
      ): element is CircuitJsonElement & {
        type: "pcb_trace"
        pcb_trace_id: string
      } =>
        element.type === "pcb_trace" &&
        typeof element.pcb_trace_id === "string",
    )
    .map((trace) => trace.pcb_trace_id)
  const traceErrors = checkEachPcbTraceNonOverlapping(circuitJson, {
    connMap,
    minClearance: options.traceClearance,
  }).map((error) => addTracePairIds(error, pcbTraceIds))
  const includeTypedTraceClearance =
    options.includeTypedTraceClearance !== false
  const viaTraceErrors = includeTypedTraceClearance
    ? checkViaTraceClearance(circuitJson, {
        connMap,
        minClearance: options.traceClearance,
      })
    : []
  const padTraceErrors = includeTypedTraceClearance
    ? checkPadTraceClearance(circuitJson, {
        connMap,
        minClearance: options.traceClearance,
      })
    : []
  const viaErrors = [
    ...checkSameNetViaSpacing(circuitJson, {
      connMap,
      minClearance: viaClearance,
    }),
    ...checkDifferentNetViaSpacing(circuitJson, {
      connMap,
      minClearance: viaClearance,
    }),
  ]

  const errors: DrcError[] = [
    ...traceErrors,
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
