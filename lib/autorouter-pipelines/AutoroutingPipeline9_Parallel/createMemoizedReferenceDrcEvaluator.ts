import {
  evaluateRelaxedDrc,
  type EvaluateRelaxedDrcInput,
  type EvaluateRelaxedDrcResult,
} from "../../testing/evaluate-relaxed-drc"
import { checkViaTraceClearanceWithLazyCenters } from "./authoritative-drc-fork/checkViaTraceClearanceWithLazyCenters"
import type { ReferenceDrcPrimitiveMemo } from "./authoritative-drc-fork/ReferenceDrcPrimitiveMemo"
import { checkTracesAreContiguous, createPrivatelyMemoizedTraceContinuityChecker } from "./authoritative-drc-fork/native/lib/check-traces-are-contiguous/check-traces-are-contiguous"
import { getParallelConnectivityMap } from "./getParallelConnectivityMap"

export type MemoizedReferenceDrcEvaluator = (
  input: EvaluateRelaxedDrcInput,
) => EvaluateRelaxedDrcResult

/** Keeps the native full checks and graph while reusing exact pure predicates. */
export function createMemoizedReferenceDrcEvaluator(
  primitiveMemo?: ReferenceDrcPrimitiveMemo,
): MemoizedReferenceDrcEvaluator {
  const continuityChecker = primitiveMemo === undefined
    ? createPrivatelyMemoizedTraceContinuityChecker()
    : (circuitJson: Parameters<typeof checkTracesAreContiguous>[0]): ReturnType<typeof checkTracesAreContiguous> =>
        checkTracesAreContiguous(circuitJson, { primitiveMemo })
  return (input: EvaluateRelaxedDrcInput): EvaluateRelaxedDrcResult =>
    evaluateRelaxedDrc({
      ...input,
      connectivityMapFactory: input.connectivityMapFactory ?? getParallelConnectivityMap,
      drcOptions: {
        viaTraceChecker: (circuitJson, options): ReturnType<typeof checkViaTraceClearanceWithLazyCenters> =>
          checkViaTraceClearanceWithLazyCenters(circuitJson, { ...options, enableAxisRejection: true, enableConnectivityMemo: true }),
        ...input.drcOptions,
        traceContinuityChecker: (circuitJson): ReturnType<typeof checkTracesAreContiguous> =>
          continuityChecker(circuitJson),
      },
    })
}
