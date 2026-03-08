import { calculateNodeProbabilityOfFailure } from "lib/solvers/UnravelSolver/calculateCrossingProbabilityOfFailure"
import { getIntraNodeCrossingsUsingCircle } from "lib/utils/getIntraNodeCrossingsUsingCircle"
import { getProblemInput } from "../dataset/getProblemInput.ts"
import type { PredictionEvaluationRow } from "../types/PredictionEvaluationRow.ts"
import type { SolveResult } from "../types/SolveResult.ts"

export const evaluatePredictions = async (
  results: SolveResult[],
): Promise<PredictionEvaluationRow[]> => {
  const rows: PredictionEvaluationRow[] = []

  for (const result of results) {
    const problem = await getProblemInput(result.fileName)
    if (!problem) {
      console.warn(`Skipping ${result.fileName} - problem file not found`)
      continue
    }

    const crossings = getIntraNodeCrossingsUsingCircle(problem)
    const predictedFailureProbability = calculateNodeProbabilityOfFailure(
      {
        ...problem,
        layer: "",
        availableZ: problem.availableZ ?? [0, 1],
      },
      crossings.numSameLayerCrossings,
      crossings.numEntryExitLayerChanges,
      crossings.numTransitionPairCrossings,
    )

    rows.push({
      fileName: result.fileName,
      didSolve: result.didSolve,
      actualDidFail: !result.didSolve,
      predictedFailureProbability,
    })
  }

  if (rows.length === 0) {
    throw new Error("No valid problems were available to evaluate")
  }

  return rows
}
