import {
  evaluateRelaxedDrc,
  type EvaluateRelaxedDrcInput,
  type EvaluateRelaxedDrcResult,
} from "../../testing/evaluate-relaxed-drc"
import { checkViaTraceClearanceWithLazyCenters } from "./authoritative-drc-fork/checkViaTraceClearanceWithLazyCenters"
import type { ReferenceDrcPrimitiveMemo } from "./authoritative-drc-fork/ReferenceDrcPrimitiveMemo"
import { checkTracesAreContiguous, createPrivatelyMemoizedTraceContinuityChecker, configurePreparedPrivatelyMemoizedTraceContinuityChecker } from "./authoritative-drc-fork/native/lib/check-traces-are-contiguous/check-traces-are-contiguous"
import { getParallelConnectivityMap } from "./getParallelConnectivityMap"

export type MemoizedReferenceDrcEvaluator = (
  input: EvaluateRelaxedDrcInput,
) => EvaluateRelaxedDrcResult

const nativeApply = Reflect.apply
const nativeWeakMapGet = WeakMap.prototype.get
const nativeWeakMapSet = WeakMap.prototype.set
const privateEvaluatorCheckers = new WeakMap<MemoizedReferenceDrcEvaluator, ReturnType<typeof createPrivatelyMemoizedTraceContinuityChecker>>()

/** Attach facts to the same original private memo; caller evaluators remain unobserved. */
export function configurePreparedMemoizedReferenceDrcEvaluator(evaluator: unknown, executor: unknown): boolean {
  if (typeof evaluator !== "function") return false
  const checker = nativeApply(nativeWeakMapGet, privateEvaluatorCheckers, [evaluator]) as ReturnType<typeof createPrivatelyMemoizedTraceContinuityChecker> | undefined
  return checker !== undefined && configurePreparedPrivatelyMemoizedTraceContinuityChecker(checker, executor)
}

/** Keeps the native full checks and graph while reusing exact pure predicates. */
export function createMemoizedReferenceDrcEvaluator(
  primitiveMemo?: ReferenceDrcPrimitiveMemo,
): MemoizedReferenceDrcEvaluator {
  const continuityChecker = primitiveMemo === undefined
    ? createPrivatelyMemoizedTraceContinuityChecker()
    : (circuitJson: Parameters<typeof checkTracesAreContiguous>[0]): ReturnType<typeof checkTracesAreContiguous> =>
        checkTracesAreContiguous(circuitJson, { primitiveMemo })
  const evaluate = (input: EvaluateRelaxedDrcInput): EvaluateRelaxedDrcResult =>
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
  if (primitiveMemo === undefined) nativeApply(nativeWeakMapSet, privateEvaluatorCheckers, [evaluate, continuityChecker])
  return evaluate
}
