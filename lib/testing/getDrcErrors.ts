import { Point } from "graphics-debug"
import {
  checkEachPcbTraceNonOverlapping,
  checkSameNetViaSpacing,
} from "@tscircuit/checks"

type CircuitJson = Parameters<typeof checkEachPcbTraceNonOverlapping>[0]
type CircuitJsonElement = CircuitJson[number]

type TraceError = ReturnType<typeof checkEachPcbTraceNonOverlapping>[number]
type ViaError = ReturnType<typeof checkSameNetViaSpacing>[number]

type DrcError = TraceError | ViaError

type DrcErrorWithCenter = DrcError & { center?: Point }

type LocationAwareDrcError = DrcError & { center: Point }

export interface GetDrcErrorsResult {
  errors: DrcError[]
  errorsWithCenters: DrcErrorWithCenter[]
  locationAwareErrors: LocationAwareDrcError[]
}

export const getDrcErrors = (circuitJson: CircuitJson): GetDrcErrorsResult => {
  const traceErrors = checkEachPcbTraceNonOverlapping(circuitJson)
  const viaErrors = checkSameNetViaSpacing(circuitJson)

  const errors: DrcError[] = [...traceErrors, ...viaErrors]

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

    if (
      "pcb_placement_error_id" in error &&
      typeof error.pcb_placement_error_id === "string" &&
      error.pcb_placement_error_id.startsWith("same_net_vias_close_")
    ) {
      const viaIds = error.pcb_placement_error_id
        .replace("same_net_vias_close_", "")
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
