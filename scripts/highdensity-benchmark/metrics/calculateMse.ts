import type { PredictionEvaluationRow } from "../types/PredictionEvaluationRow.ts"

export const calculateMse = (rows: PredictionEvaluationRow[]) => {
  // MSE is the average squared difference between predicted and actual failure.
  return (
    rows.reduce((sum, row) => {
      const actualFailure = row.actualDidFail ? 1 : 0
      return sum + (row.predictedFailureProbability - actualFailure) ** 2
    }, 0) / rows.length
  )
}
