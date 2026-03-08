import {
  calculateClassificationMetrics,
  type ClassificationMetrics,
} from "./calculateClassificationMetrics.ts"
import { getFailF1 } from "./getFailF1.ts"
import { getUniqueThresholdCandidates } from "./getUniqueThresholdCandidates.ts"
import type { PredictionEvaluationRow } from "../types/PredictionEvaluationRow.ts"

type ThresholdSearchResult = {
  bestThreshold: number
  bestMetrics: ClassificationMetrics
  optimizedFor: "failF1"
}

export const findBestThreshold = (
  rows: PredictionEvaluationRow[],
): ThresholdSearchResult => {
  const thresholds = getUniqueThresholdCandidates(rows)

  let bestMetrics = calculateClassificationMetrics(rows, thresholds[0] ?? 0.5)
  let bestThreshold = bestMetrics.threshold
  let bestScore = getFailF1(bestMetrics)

  for (const threshold of thresholds.slice(1)) {
    const metrics = calculateClassificationMetrics(rows, threshold)
    const score = getFailF1(metrics)

    if (score > bestScore) {
      bestScore = score
      bestThreshold = threshold
      bestMetrics = metrics
      continue
    }

    if (score === bestScore && threshold < bestThreshold) {
      bestThreshold = threshold
      bestMetrics = metrics
    }
  }

  return {
    bestThreshold,
    bestMetrics,
    optimizedFor: "failF1",
  }
}
