import type { ClassificationMetrics } from "./calculateClassificationMetrics.ts"

export const getFailF1 = (metrics: ClassificationMetrics) => {
  const { precision, recall } = metrics.fail
  if (precision + recall === 0) return 0
  return (2 * precision * recall) / (precision + recall)
}
