import {
  checkScopedCopperClearance,
  checkDifferentNetViaSpacing,
  checkEachPcbTraceNonOverlapping,
  checkHoleTraceClearance,
  checkPadTraceClearance,
  checkPcbTracesOutOfBoard,
  checkSameNetViaSpacing,
  checkTracesAreContiguous,
  checkViaPadClearance,
  checkViaTraceClearance,
} from "@tscircuit/checks"
import type {
  AnyCircuitElement,
  PcbClearanceError,
  PcbPadPadClearanceError,
  PcbPadTraceClearanceError,
  PcbTraceError,
  PcbViaClearanceError,
  PcbViaTraceClearanceError,
} from "circuit-json"
import { Point } from "graphics-debug"
import type { GetDrcErrorsOptions } from "lib/types/drc-types"
import { createDrcConnectivityMap } from "lib/utils/createDrcConnectivityMap"
import { MIN_VIA_TO_VIA_CLEARANCE } from "lib/utils/drcPresets"

type CircuitJson = AnyCircuitElement[]
type CircuitJsonElement = CircuitJson[number]

type ViaPadDrcError = PcbPadPadClearanceError & {
  pcb_via_ids: string[]
  pcb_trace_id?: string
}

type DrcError =
  | PcbClearanceError
  | PcbTraceError
  | PcbViaTraceClearanceError
  | PcbPadTraceClearanceError
  | PcbViaClearanceError
  | ViaPadDrcError

type DrcErrorWithCenter = DrcError & { center?: Point }

type LocationAwareDrcError = DrcError & { center: Point }

export {
  MIN_VIA_TO_VIA_CLEARANCE,
  PREFERRED_VIA_TO_VIA_CLEARANCE,
} from "lib/utils/drcPresets"
export type { GetDrcErrorsOptions } from "lib/types/drc-types"

export interface GetDrcErrorsResult {
  errors: DrcError[]
  errorsWithCenters: DrcErrorWithCenter[]
  locationAwareErrors: LocationAwareDrcError[]
}

export const getDrcErrors = (
  circuitJson: CircuitJson,
  options: GetDrcErrorsOptions = {},
): GetDrcErrorsResult => {
  const connMap = createDrcConnectivityMap(circuitJson)
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
  const viaClearance = Math.max(
    options.viaClearance ?? MIN_VIA_TO_VIA_CLEARANCE,
    MIN_VIA_TO_VIA_CLEARANCE,
  )
  const traceErrors = checkEachPcbTraceNonOverlapping(circuitJson, {
    connMap,
    minClearance: options.traceClearance,
  }).filter((error) => error.type !== "pcb_keepout_overlap_warning")
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
  const holeTraceErrors = checkHoleTraceClearance(circuitJson, {
    minClearance: options.holeClearance,
  })
  const viaPadErrors = checkViaPadClearance(circuitJson, {
    connMap,
    minClearance: options.viaToPadClearance,
  }).map((error): ViaPadDrcError => {
    const viaIds = error.pcb_pad_ids.filter((id) => viasById.has(id))
    const via = viasById.get(viaIds[0])
    // Preserve explicit ownership for evaluators that consume reference errors
    // directly, as well as the Pipeline9 repair normalizer.
    return {
      ...error,
      pcb_via_ids: viaIds,
      ...(via && typeof via.pcb_trace_id === "string"
        ? { pcb_trace_id: via.pcb_trace_id }
        : {}),
    }
  })
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
    ...checkScopedCopperClearance(circuitJson, { connMap }),
    ...traceErrors,
    ...checkPcbTracesOutOfBoard(circuitJson),
    ...(options.includeTraceContinuity === false
      ? []
      : checkTracesAreContiguous(circuitJson)),
    ...viaTraceErrors,
    ...padTraceErrors,
    ...holeTraceErrors,
    ...viaPadErrors,
    ...viaErrors,
  ]

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
