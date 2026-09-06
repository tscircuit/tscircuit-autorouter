import {
  checkDifferentNetViaSpacing,
  checkEachPcbPortConnectedToPcbTraces,
  checkEachPcbTraceNonOverlapping,
  checkPadTraceClearance,
  checkPcbTraceLengths,
  checkPcbTraceViaCounts,
  checkPcbTracesOutOfBoard,
  checkSameNetViaSpacing,
  checkSourceTracesHavePcbTraces,
  checkTracesAreContiguous,
  checkViaPadClearance,
  checkViaTraceClearance,
  checkViasInPads,
  dedupePcbDrcErrors,
} from "@tscircuit/checks"
import type {
  AnyCircuitElement,
  PcbPadPadClearanceError,
  PcbTraceTooLongWarning,
  PcbVia,
} from "circuit-json"
import {
  combinePreloadedAndRoutedTraces,
  type EvaluateRelaxedDrcInput,
} from "./evaluate-relaxed-drc"
import {
  convertToCircuitJson,
  createPcbBoardElement,
} from "./utils/convertToCircuitJson"

type CoreRoutingDrcError = AnyCircuitElement & {
  center?: { x: number; y: number }
  pcb_center?: { x: number; y: number }
}

export interface EvaluateCoreRoutingDrcResult {
  circuitJson: AnyCircuitElement[]
  errors: CoreRoutingDrcError[]
  errorsWithCenters: CoreRoutingDrcError[]
  locationAwareErrors: Array<
    CoreRoutingDrcError & { center: { x: number; y: number } }
  >
  warnings: PcbTraceTooLongWarning[]
}

const addRepairOwnership = (
  errors: AnyCircuitElement[],
  circuitJson: AnyCircuitElement[],
  maxViaCountErrors: ReadonlySet<AnyCircuitElement>,
): CoreRoutingDrcError[] => {
  const viaById = new Map(
    circuitJson.flatMap((element) =>
      element.type === "pcb_via"
        ? [[element.pcb_via_id, element] as const]
        : [],
    ),
  )
  const viasByTraceId = new Map<string, PcbVia[]>()
  for (const via of viaById.values()) {
    if (typeof via.pcb_trace_id !== "string") continue
    const traceVias = viasByTraceId.get(via.pcb_trace_id) ?? []
    traceVias.push(via)
    viasByTraceId.set(via.pcb_trace_id, traceVias)
  }
  const viaPadErrors = errors.filter(
    (error): error is PcbPadPadClearanceError =>
      error.type === "pcb_pad_pad_clearance_error",
  )

  return errors.map((error) => {
    if (
      error.type === "pcb_pad_pad_clearance_error" &&
      Array.isArray(error.pcb_pad_ids)
    ) {
      const via = error.pcb_pad_ids
        .map((id) => viaById.get(id))
        .find((candidate) => candidate !== undefined)
      if (via) {
        return {
          ...error,
          pcb_trace_id: via.pcb_trace_id,
          pcb_via_id: via.pcb_via_id,
          pcb_via_ids: [via.pcb_via_id],
        } as CoreRoutingDrcError
      }
    }

    if (
      error.type === "pcb_trace_error" &&
      typeof error.pcb_trace_id === "string" &&
      maxViaCountErrors.has(error)
    ) {
      const vias = viasByTraceId.get(error.pcb_trace_id) ?? []
      const firstVia = vias[0]
      return {
        ...error,
        pcb_via_ids: vias.map((via) => via.pcb_via_id),
        ...(firstVia
          ? {
              pcb_via_id: firstVia.pcb_via_id,
              center: { x: firstVia.x, y: firstVia.y },
            }
          : {}),
      } as CoreRoutingDrcError
    }

    if (error.type === "pcb_placement_error") {
      const matchingViaPadError = viaPadErrors.find((candidate) =>
        candidate.pcb_pad_ids.some((id) =>
          error.pcb_placement_error_id.includes(id),
        ),
      )
      const via = matchingViaPadError?.pcb_pad_ids
        .map((id) => viaById.get(id))
        .find((candidate) => candidate !== undefined)
      const center = matchingViaPadError?.center
      if (
        via &&
        center &&
        typeof center.x === "number" &&
        typeof center.y === "number"
      ) {
        return {
          ...error,
          pcb_trace_id: via.pcb_trace_id,
          pcb_via_id: via.pcb_via_id,
          pcb_via_ids: [via.pcb_via_id],
          center: { x: center.x, y: center.y },
        } as CoreRoutingDrcError
      }
    }

    return error as CoreRoutingDrcError
  })
}

/**
 * Runs Core's final routing checks plus the route-dependent via-in-pad
 * placement check. This is the authoritative acceptance evaluator; hot-path
 * candidate scoring remains in Repair03's indexed DRC engine.
 */
export const evaluateCoreRoutingDrc = ({
  inputSrj,
  srjWithPointPairs,
  routedTraces,
}: Omit<
  EvaluateRelaxedDrcInput,
  "drcOptions"
>): EvaluateCoreRoutingDrcResult => {
  const jointTraces = combinePreloadedAndRoutedTraces(
    inputSrj.traces ?? [],
    routedTraces,
  )
  const circuitJson = [
    createPcbBoardElement(inputSrj),
    ...convertToCircuitJson(srjWithPointPairs, jointTraces, {
      minTraceWidth: inputSrj.minTraceWidth,
      minViaDiameter: inputSrj.minViaDiameter,
      minViaHoleDiameter: inputSrj.minViaHoleDiameter,
      originalSrj: inputSrj,
      includeOriginalConnections: true,
    }),
  ]
  const warnings = checkPcbTraceLengths(circuitJson)
  const maxViaCountErrors = checkPcbTraceViaCounts(circuitJson)
  const routingErrors = [
    ...checkEachPcbPortConnectedToPcbTraces(circuitJson),
    ...checkSourceTracesHavePcbTraces(circuitJson),
    ...maxViaCountErrors,
    ...checkEachPcbTraceNonOverlapping(circuitJson),
    ...checkPadTraceClearance(circuitJson),
    ...checkViaTraceClearance(circuitJson),
    ...checkViaPadClearance(circuitJson),
    ...checkSameNetViaSpacing(circuitJson),
    ...checkDifferentNetViaSpacing(circuitJson),
    ...checkTracesAreContiguous(circuitJson),
    ...checkPcbTracesOutOfBoard(circuitJson),
    ...checkViasInPads(circuitJson),
  ] as AnyCircuitElement[]
  const errors = addRepairOwnership(
    dedupePcbDrcErrors(routingErrors),
    circuitJson,
    new Set(maxViaCountErrors),
  )
  const errorsWithCenters = errors.filter(
    (error) => error.center !== undefined || error.pcb_center !== undefined,
  )
  const locationAwareErrors = errorsWithCenters.map((error) => ({
    ...error,
    center: error.center ?? error.pcb_center!,
  }))

  return {
    circuitJson,
    errors,
    errorsWithCenters,
    locationAwareErrors,
    warnings,
  }
}
