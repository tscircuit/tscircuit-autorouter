export type PredictionEvaluationRow = {
  fileName: string
  didSolve: boolean
  actualDidFail: boolean
  predictedFailureProbability: number
}
