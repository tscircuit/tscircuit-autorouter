/**
 * Feature-scoped derivative of evaluate-relaxed-drc.ts at e703f049:
 * SHA256 87238d33bc0ed1316ccdbfb85958139dcfa4dc4bf315e2200d85fb78194243a2.
 * Original repository MIT license applies. The candidate converter changes;
 * preloaded-copper combination, board materialization and all predicates do not.
 */
import type { AnyCircuitElement } from "circuit-json"
import { RELAXED_DRC_OPTIONS } from "lib/testing/drcPresets"
import {
  combinePreloadedAndRoutedTraces,
  type EvaluateRelaxedDrcInput,
  type EvaluateRelaxedDrcResult,
} from "lib/testing/evaluate-relaxed-drc"
import { getDrcErrors } from "lib/testing/getDrcErrors"
import { createPcbBoardElement } from "lib/testing/utils/convertToCircuitJson"
import type { SimplifiedPcbTrace } from "lib/types"
import { getViaToPadClearance } from "lib/utils/getViaToPadClearance"

export function evaluatePreparedRepairDrc({
  inputSrj,
  routedTraces,
  drcOptions,
  includeBoardClearance = false,
  circuitJsonConverter,
}: EvaluateRelaxedDrcInput & {
  circuitJsonConverter: (routes: SimplifiedPcbTrace[]) => AnyCircuitElement[]
}): EvaluateRelaxedDrcResult {
  const jointTraces = combinePreloadedAndRoutedTraces(
    inputSrj.traces ?? [],
    routedTraces,
  )
  const circuitJson = circuitJsonConverter(jointTraces)
  if (includeBoardClearance) {
    circuitJson.push(createPcbBoardElement({
      ...inputSrj,
      minBoardEdgeClearance: inputSrj.minBoardEdgeClearance ?? 0,
    }))
  }
  return {
    circuitJson,
    ...getDrcErrors(circuitJson, {
      ...RELAXED_DRC_OPTIONS,
      holeClearance: inputSrj.minTraceToHoleEdgeClearance,
      viaToPadClearance: getViaToPadClearance(inputSrj),
      ...drcOptions,
    }),
  }
}
