import {
  evaluateRelaxedDrc,
  type EvaluateRelaxedDrcInput,
  type EvaluateRelaxedDrcResult,
} from "../../lib/testing/evaluate-relaxed-drc"
import { loadSrj18PhysicalPadElements } from "./loadSrj18PhysicalPadElements"

/** Evaluate both benchmark variants against their original physical board. */
export const evaluateParallelBenchmarkDrc = (
  input: Omit<EvaluateRelaxedDrcInput, "includeBoardClearance" | "physicalPadElements">,
): EvaluateRelaxedDrcResult => {
  return evaluateRelaxedDrc({
    ...input,
    includeBoardClearance: true,
    physicalPadElements: loadSrj18PhysicalPadElements(input.inputSrj),
  })
}
