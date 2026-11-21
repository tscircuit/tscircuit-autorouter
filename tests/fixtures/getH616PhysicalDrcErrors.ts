import {
  checkDanglingTraces,
  checkDifferentNetViaSpacing,
  checkEachPcbTraceNonOverlapping,
  checkHoleTraceClearance,
  checkPadTraceClearance,
  checkPcbTracesOutOfBoard,
  checkTracesAreContiguous,
  checkViaPadClearance,
  checkViaTraceClearance,
  checkViasInPads,
  checkViasOffBoard,
} from "@tscircuit/checks"
import type { AnyCircuitElement } from "circuit-json"

export function getH616PhysicalDrcErrors({
  circuitJson,
  minClearance,
}: {
  circuitJson: AnyCircuitElement[]
  minClearance: number
}): AnyCircuitElement[] {
  const clearanceOptions = { minClearance }
  return [
    ...checkEachPcbTraceNonOverlapping(circuitJson, clearanceOptions),
    ...checkPadTraceClearance(circuitJson, clearanceOptions),
    ...checkViaTraceClearance(circuitJson, clearanceOptions),
    ...checkViaPadClearance(circuitJson, clearanceOptions),
    ...checkDifferentNetViaSpacing(circuitJson),
    ...checkHoleTraceClearance(circuitJson, clearanceOptions),
    ...checkTracesAreContiguous(circuitJson),
    ...checkDanglingTraces(circuitJson),
    ...checkPcbTracesOutOfBoard(circuitJson),
    ...checkViasOffBoard(circuitJson),
    ...checkViasInPads(circuitJson),
  ]
}
