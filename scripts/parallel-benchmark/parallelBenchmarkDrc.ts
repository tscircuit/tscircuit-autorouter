import {
  evaluateRelaxedDrc,
  type EvaluateRelaxedDrcInput,
  type EvaluateRelaxedDrcResult,
} from "../../lib/testing/evaluate-relaxed-drc"

/** Evaluate both benchmark variants against their original physical board. */
export const evaluateParallelBenchmarkDrc = (
  input: Omit<EvaluateRelaxedDrcInput, "includeBoardClearance">,
): EvaluateRelaxedDrcResult => {
  return evaluateRelaxedDrc({
    ...input,
    includeBoardClearance: true,
  })
}
