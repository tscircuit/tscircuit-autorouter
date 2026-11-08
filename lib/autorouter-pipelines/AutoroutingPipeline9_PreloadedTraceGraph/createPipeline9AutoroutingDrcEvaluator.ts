import { createPipeline9KeepoutDrcEvaluator } from "./createPipeline9KeepoutDrcEvaluator"
import type { AnyCircuitElement } from "circuit-json"
import {
  type CircuitJsonConnectivityMaps,
  convertToCircuitJson,
  createPcbBoardElement,
} from "lib/utils/convertToCircuitJson"
import type {
  GetDrcErrorsOptions,
  SimpleRouteJson,
  SimplifiedPcbTrace,
} from "lib/types"
import { createDrcConnectivityMap } from "lib/utils/createDrcConnectivityMap"
import { getRetainedDrilledCopper } from "lib/utils/getRetainedDrilledCopper"
import { RELAXED_DRC_OPTIONS } from "lib/utils/drcPresets"
import { annotateTraceEndpointPorts } from "lib/utils/autorouting-drc/annotateTraceEndpointPorts"
import { checkBoardTraceClearance } from "lib/utils/autorouting-drc/checkBoardTraceClearance"
import { checkTraceContinuity } from "lib/utils/autorouting-drc/checkTraceContinuity"
import { checkViaPairClearance } from "lib/utils/autorouting-drc/checkViaPairClearance"
import { createTraceObstacleClearanceEvaluator } from "lib/utils/autorouting-drc/createTraceObstacleClearanceEvaluator"
import { createViaPadClearanceEvaluator } from "lib/utils/autorouting-drc/createViaPadClearanceEvaluator"
import { combinePreloadedAndRoutedTraces } from "lib/utils/combinePreloadedAndRoutedTraces"
import { getViaToPadClearance } from "lib/utils/getViaToPadClearance"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { createPipeline9FixedCopperDrcEvaluator } from "./createPipeline9FixedCopperDrcEvaluator"
import { createPipeline9CopperPourWireDrcEvaluator } from "./createPipeline9CopperPourWireDrcEvaluator"

type DrcError = Record<string, unknown>

export type Pipeline9AutoroutingDrcResult = {
  circuitJson: AnyCircuitElement[]
  errors: DrcError[]
  errorsWithCenters: DrcError[]
  locationAwareErrors: DrcError[]
}

export type Pipeline9AutoroutingDrcEvaluator = ((
  routedTraces: SimplifiedPcbTrace[],
  options?: { includeTraceContinuity?: boolean },
) => Pipeline9AutoroutingDrcResult) & {
  readonly evaluateFixedCopper: (traces: SimplifiedPcbTrace[]) => DrcError[]
}

/** Reuses static pad geometry while evaluating joint repair candidates. */
export const createPipeline9AutoroutingDrcEvaluator = ({
  inputSrj,
  srjWithPointPairs,
  drcOptions = {},
  includeBoardClearance = false,
  connectivityMaps,
}: {
  inputSrj: SimpleRouteJson
  srjWithPointPairs: SimpleRouteJson
  drcOptions?: GetDrcErrorsOptions
  includeBoardClearance?: boolean
  connectivityMaps?: CircuitJsonConnectivityMaps
}): Pipeline9AutoroutingDrcEvaluator => {
  const conversionOptions = {
    minTraceWidth: inputSrj.minTraceWidth,
    minViaDiameter: inputSrj.minViaDiameter,
    originalSrj: inputSrj,
    includeOriginalConnections: true,
    connectivityMaps,
  }
  // Completed routing phases can leave only preloaded traces and pad aliases.
  // Preserve those declared logical nets when checking the converted geometry.
  const declaredConnectivity = getConnectivityMapFromSimpleRouteJson({
    ...srjWithPointPairs,
    traces: inputSrj.traces,
  })
  const declaredNetGroups = Array.from(
    new Set(Object.values(declaredConnectivity.idToNetMap)),
    (netId) => declaredConnectivity.getIdsConnectedToNet(netId),
  )
  const board = includeBoardClearance
    ? createPcbBoardElement({
        ...inputSrj,
        minBoardEdgeClearance: inputSrj.minBoardEdgeClearance ?? 0,
      })
    : undefined
  const representedPadObstacleIndexes = new Set<number>()
  const staticCircuitJson = convertToCircuitJson(srjWithPointPairs, [], {
    ...conversionOptions,
    representedPadObstacleIndexes,
  })
  const retainedDrilledCopper = getRetainedDrilledCopper(inputSrj)
  staticCircuitJson.push(...retainedDrilledCopper)
  if (board) staticCircuitJson.push(board)
  const evaluateTraceObstacles = createTraceObstacleClearanceEvaluator(
    staticCircuitJson,
    {
      traceClearance:
        drcOptions.traceClearance ?? RELAXED_DRC_OPTIONS.traceClearance,
      holeClearance:
        drcOptions.holeClearance ?? inputSrj.minTraceToHoleEdgeClearance,
    },
  )
  const evaluateViaPads = createViaPadClearanceEvaluator(staticCircuitJson, {
    allowViaInPad: inputSrj.allowViaInPad,
    minClearance:
      drcOptions.viaToPadClearance ?? getViaToPadClearance(inputSrj),
  })
  const evaluateFixedCopper = createPipeline9FixedCopperDrcEvaluator({
    inputSrj,
    srjWithPointPairs,
    representedPadObstacleIndexes,
    viaClearance: drcOptions.viaToPadClearance,
  })
  const evaluateKeepouts = createPipeline9KeepoutDrcEvaluator(
    inputSrj,
    drcOptions.traceClearance ?? RELAXED_DRC_OPTIONS.traceClearance,
    drcOptions.viaToPadClearance ??
      getViaToPadClearance(inputSrj) ??
      RELAXED_DRC_OPTIONS.traceClearance,
  )
  const evaluatePourWires = createPipeline9CopperPourWireDrcEvaluator(
    inputSrj,
    srjWithPointPairs,
  )
  const evaluate = (
    routedTraces: SimplifiedPcbTrace[],
    options: { includeTraceContinuity?: boolean } = {},
  ): Pipeline9AutoroutingDrcResult => {
    const traces = combinePreloadedAndRoutedTraces(
      inputSrj.traces ?? [],
      routedTraces,
    )
    const circuitJson = convertToCircuitJson(
      srjWithPointPairs,
      traces,
      conversionOptions,
    )
    circuitJson.push(...retainedDrilledCopper)
    if (board) circuitJson.push(board)
    const connMap = createDrcConnectivityMap(circuitJson)
    connMap.addConnections(declaredNetGroups)
    annotateTraceEndpointPorts(circuitJson)
    const obstacleErrors = evaluateTraceObstacles(circuitJson, connMap)
    const errors = [
      ...obstacleErrors.traceErrors,
      ...evaluateFixedCopper(traces),
      ...evaluateKeepouts(traces),
      ...evaluatePourWires(traces),
      ...checkBoardTraceClearance(circuitJson, { board }),
      ...((options.includeTraceContinuity ??
        drcOptions.includeTraceContinuity) === false
        ? []
        : checkTraceContinuity(circuitJson, {
            retainedViaObstacles: srjWithPointPairs.obstacles.filter(
              (obstacle) => obstacle.circuitJsonMetadata?.pcb_via_id,
            ),
            copperPours: srjWithPointPairs.obstacles.filter(
              (obstacle) => obstacle.isCopperPour,
            ),
          })),
      ...(drcOptions.includeTypedTraceClearance === false
        ? []
        : [...obstacleErrors.viaErrors, ...obstacleErrors.padErrors]),
      ...obstacleErrors.holeErrors,
      ...evaluateViaPads(circuitJson, connMap),
      ...checkViaPairClearance(circuitJson, connMap, {
        viaClearance:
          drcOptions.viaClearance ?? RELAXED_DRC_OPTIONS.viaClearance,
      }),
    ]
    const viasById = new Map(
      circuitJson.flatMap((element) =>
        element.type === "pcb_via"
          ? [[element.pcb_via_id, element] as const]
          : [],
      ),
    )
    const errorsWithCenters = errors.map((error): DrcError => {
      if (error.type === "pcb_via_trace_clearance_error") {
        const via = viasById.get(error.pcb_via_id as string)
        if (via) return { ...error, center: { x: via.x, y: via.y } }
      }
      if (error.center) return error
      if (error.pcb_center) return { ...error, center: error.pcb_center }
      return error
    })
    return {
      circuitJson,
      errors,
      errorsWithCenters,
      locationAwareErrors: errorsWithCenters.filter((error) =>
        Boolean(error.center),
      ),
    }
  }
  return Object.assign(evaluate, { evaluateFixedCopper })
}
