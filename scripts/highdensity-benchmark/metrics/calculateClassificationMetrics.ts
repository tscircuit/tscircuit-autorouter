import type { PredictionEvaluationRow } from "../types/PredictionEvaluationRow.ts"
import { safeDivide } from "./safeDivide.ts"

type ClassMetrics = {
  precision: number
  recall: number
}

export type ClassificationMetrics = {
  threshold: number
  totalEvaluated: number
  failF1: number
  confusionMatrix: {
    truePositiveFail: number
    falsePositiveFail: number
    falseNegativeFail: number
    trueNegativeFail: number
  }
  support: {
    actualPass: number
    actualFail: number
    predictedPass: number
    predictedFail: number
  }
  pass: ClassMetrics
  fail: ClassMetrics
}

export const calculateClassificationMetrics = (
  rows: PredictionEvaluationRow[],
  threshold = 0.5,
): ClassificationMetrics => {
  let tpFail = 0
  let fpFail = 0
  let fnFail = 0
  let tnFail = 0

  for (const row of rows) {
    const predictedDidFail = row.predictedFailureProbability >= threshold
    const actualDidFail = row.actualDidFail

    if (predictedDidFail) {
      if (actualDidFail) {
        tpFail += 1
      } else {
        fpFail += 1
      }
    } else if (actualDidFail) {
      fnFail += 1
    } else {
      tnFail += 1
    }
  }

  const predictedPassCount = tnFail + fnFail
  const predictedFailCount = tpFail + fpFail
  const actualPassCount = tnFail + fpFail
  const actualFailCount = tpFail + fnFail
  const truePassCount = tnFail
  const trueFailCount = tpFail

  return {
    threshold,
    totalEvaluated: rows.length,
    failF1: safeDivide(
      2 *
        safeDivide(trueFailCount, predictedFailCount) *
        safeDivide(trueFailCount, actualFailCount),
      safeDivide(trueFailCount, predictedFailCount) +
        safeDivide(trueFailCount, actualFailCount),
    ),
    confusionMatrix: {
      truePositiveFail: tpFail,
      falsePositiveFail: fpFail,
      falseNegativeFail: fnFail,
      trueNegativeFail: tnFail,
    },
    support: {
      actualPass: actualPassCount,
      actualFail: actualFailCount,
      predictedPass: predictedPassCount,
      predictedFail: predictedFailCount,
    },
    pass: {
      precision: safeDivide(truePassCount, predictedPassCount),
      recall: safeDivide(truePassCount, actualPassCount),
    },
    fail: {
      precision: safeDivide(trueFailCount, predictedFailCount),
      recall: safeDivide(trueFailCount, actualFailCount),
    },
  }
}
