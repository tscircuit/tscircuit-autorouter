import {
  checkDifferentNetViaSpacing,
  checkEachPcbTraceNonOverlapping,
  checkSameNetViaSpacing,
  checkViaTraceClearance,
} from "@tscircuit/checks"
import type { PcbVia, PcbViaTraceClearanceError } from "circuit-json"
import { Point } from "graphics-debug"

type CircuitJson = Parameters<typeof checkEachPcbTraceNonOverlapping>[0]
type CircuitJsonElement = CircuitJson[number]

type TraceError = ReturnType<typeof checkEachPcbTraceNonOverlapping>[number]
type SameNetViaError = ReturnType<typeof checkSameNetViaSpacing>[number]
type DifferentNetViaError = ReturnType<
  typeof checkDifferentNetViaSpacing
>[number]
type ViaError =
  | SameNetViaError
  | DifferentNetViaError
  | PcbViaTraceClearanceError

type DrcError = TraceError | ViaError

type DrcErrorWithCenter = DrcError & { center?: Point }

type LocationAwareDrcError = DrcError & { center: Point }

const getPoint = (
  point: unknown,
): Point | null => {
  if (!point || typeof point !== "object") return null
  if (!("x" in point) || !("y" in point)) return null

  const { x, y } = point
  if (typeof x !== "number" || typeof y !== "number") return null

  return { x, y }
}

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
}

const getPcbViasById = (
  circuitJson: CircuitJson,
): Map<string, PcbVia> => {
  const vias = circuitJson.filter(
    (element): element is PcbVia => element.type === "pcb_via",
  )
  const viasById = new Map<string, PcbVia>()

  for (const via of vias) {
    viasById.set(via.pcb_via_id, via)
  }

  return viasById
}

export const getDrcErrors = (
  circuitJson: CircuitJson,
  options: GetDrcErrorsOptions = {},
): GetDrcErrorsResult => {
  const viaClearance = Math.max(
    options.viaClearance ?? MIN_VIA_TO_VIA_CLEARANCE,
    MIN_VIA_TO_VIA_CLEARANCE,
  )
  const viasById = getPcbViasById(circuitJson)
  const circuitJsonWithoutVias = circuitJson.filter(
    (element) => element.type !== "pcb_via",
  )

  const traceErrors = checkEachPcbTraceNonOverlapping(circuitJsonWithoutVias, {
    minClearance: options.traceClearance,
  })
  const viaTraceErrors = checkViaTraceClearance(circuitJson, {
    minClearance: options.traceClearance,
  })
  const viaErrors = [
    ...viaTraceErrors,
    ...checkSameNetViaSpacing(circuitJson, {
      minClearance: viaClearance,
    }),
    ...checkDifferentNetViaSpacing(circuitJson, {
      minClearance: viaClearance,
    }),
  ]

  const errors: DrcError[] = [
    ...traceErrors,
    ...viaErrors,
  ]

  const errorsWithCenters: DrcErrorWithCenter[] = errors.map((error) => {
    if ("center" in error) {
      const center = getPoint(error.center)
      if (center) {
        return {
          ...error,
          center,
        }
      }

      const { center: _center, ...errorWithoutCenter } = error
      return errorWithoutCenter
    }

    if ("pcb_center" in error && error.pcb_center) {
      const center = getPoint(error.pcb_center)
      if (center) {
        return {
          ...error,
          center,
        }
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
  })
  const locationAwareErrors = errorsWithCenters.filter(
    (error): error is LocationAwareDrcError => Boolean(error.center),
  )

  return {
    errors,
    errorsWithCenters,
    locationAwareErrors,
  }
}
