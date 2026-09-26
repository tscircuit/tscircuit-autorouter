import {
  checkEachPcbTraceNonOverlapping,
  checkHoleTraceClearance,
} from "@tscircuit/checks"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "lib/types"
import { convertToCircuitJson } from "lib/testing/utils/convertToCircuitJson"

/** Reject overlapping copper as well as insufficient physical hole clearance. */
export function getTraceToHoleClearanceError(
  srj: SimpleRouteJson,
  traces: SimplifiedPcbTraces,
): string | null {
  if (srj.minTraceToHoleEdgeClearance === undefined) return null
  const circuitJson = convertToCircuitJson(srj, traces, { originalSrj: srj })
  const overlap = checkEachPcbTraceNonOverlapping(circuitJson, {
    minClearance: 0,
  })[0]
  if (overlap) return overlap.message
  return (
    checkHoleTraceClearance(circuitJson, {
      minClearance: srj.minTraceToHoleEdgeClearance,
    })[0]?.message ?? null
  )
}
