import { getViaInPadErrorsWithCenters } from "./getViaInPadErrorsWithCenters"
import {
  checkDifferentNetViaSpacing,
  checkEachPcbTraceNonOverlapping,
  checkPadTraceClearance,
  checkPcbTracesOutOfBoard,
  checkSameNetViaSpacing,
  checkTracesAreContiguous,
  checkViaPadClearance,
  checkViaTraceClearance,
} from "@tscircuit/checks"
import type {
  AnyCircuitElement,
  PcbPadTraceClearanceError,
  PcbPadPadClearanceError,
  PcbPlacementError,
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

export type DrcError =
  | PcbTraceError
  | PcbViaTraceClearanceError
  | PcbPadTraceClearanceError
  | PcbViaClearanceError
  | PcbPadPadClearanceError
  | PcbPlacementError

export type DrcErrorWithCenter = DrcError & { center?: Point }

export type LocationAwareDrcError = DrcError & { center: Point }

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
  /** Include via-in-pad placement and via-to-pad clearance checks. */
  includeViaPadChecks?: boolean
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

export const getDrcErrors = (
  circuitJson: CircuitJson,
  options: GetDrcErrorsOptions = {},
): GetDrcErrorsResult => {
  const connMap = createDrcConnectivityMap(circuitJson)
  const viaClearance = Math.max(
    options.viaClearance ?? MIN_VIA_TO_VIA_CLEARANCE,
    MIN_VIA_TO_VIA_CLEARANCE,
  )
  const traceErrors = checkEachPcbTraceNonOverlapping(circuitJson, {
    connMap,
    minClearance: options.traceClearance,
  })
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
  const viaPadErrors = options.includeViaPadChecks
    ? [
        ...getViaInPadErrorsWithCenters(circuitJson),
        ...checkViaPadClearance(circuitJson, {
          connMap,
          minClearance: options.traceClearance,
        }),
      ]
    : []

  const errors: DrcError[] = [
    ...traceErrors,
    ...checkPcbTracesOutOfBoard(circuitJson),
    ...(options.includeTraceContinuity === false
      ? []
      : checkTracesAreContiguous(circuitJson)),
    ...viaTraceErrors,
    ...padTraceErrors,
    ...viaErrors,
    ...viaPadErrors,
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
