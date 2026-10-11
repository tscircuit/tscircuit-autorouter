import {
  evaluateRelaxedDrc,
  type EvaluateRelaxedDrcInput,
  type EvaluateRelaxedDrcResult,
} from "../../testing/evaluate-relaxed-drc"
import { checkViaTraceClearanceWithLazyCenters } from "./authoritative-drc-fork/checkViaTraceClearanceWithLazyCenters"
import { ReferenceDrcPrimitiveMemo } from "./authoritative-drc-fork/ReferenceDrcPrimitiveMemo"
import { checkTracesAreContiguous } from "./authoritative-drc-fork/native/lib/check-traces-are-contiguous/check-traces-are-contiguous"
import { getParallelConnectivityMap } from "./getParallelConnectivityMap"

export type MemoizedReferenceDrcEvaluator = (
  input: EvaluateRelaxedDrcInput,
) => EvaluateRelaxedDrcResult

/** Keeps the native full checks and graph while reusing exact pure predicates. */
export function createMemoizedReferenceDrcEvaluator(
  primitiveMemo = new ReferenceDrcPrimitiveMemo(),
): MemoizedReferenceDrcEvaluator {
  return (input: EvaluateRelaxedDrcInput): EvaluateRelaxedDrcResult =>
    evaluateRelaxedDrc({
      ...input,
      connectivityMapFactory: input.connectivityMapFactory ?? getParallelConnectivityMap,
      drcOptions: {
        viaTraceChecker: (circuitJson, options): ReturnType<typeof checkViaTraceClearanceWithLazyCenters> =>
          checkViaTraceClearanceWithLazyCenters(circuitJson, { ...options, enableAxisRejection: true, enableConnectivityMemo: true }),
        ...input.drcOptions,
        traceContinuityChecker: (circuitJson): ReturnType<typeof checkTracesAreContiguous> =>
          checkTracesAreContiguous(circuitJson, { primitiveMemo }),
      },
    })
}
