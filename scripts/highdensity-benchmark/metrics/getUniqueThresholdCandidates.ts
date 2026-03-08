import type { PredictionEvaluationRow } from "../types/PredictionEvaluationRow.ts"

export const getUniqueThresholdCandidates = (
  rows: PredictionEvaluationRow[],
) => {
  const thresholds = new Set<number>([0, 1])
  for (const row of rows) {
    thresholds.add(Number(row.predictedFailureProbability.toFixed(8)))
  }
  return Array.from(thresholds).sort((left, right) => left - right)
}
