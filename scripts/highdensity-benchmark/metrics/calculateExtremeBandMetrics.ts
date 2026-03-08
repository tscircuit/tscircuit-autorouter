import type { PredictionEvaluationRow } from "../types/PredictionEvaluationRow.ts"
import { safeDivide } from "./safeDivide.ts"

type ClassMetrics = {
  precision: number
  recall: number
}

export type ExtremeBandMetrics = {
  policy: {
    passAtOrBelow: number
    failAtOrAbove: number
  }
  totalEvaluated: number
  coverage: {
    confidentPass: number
    confidentFail: number
    ignoredMiddle: number
    confidentPredictions: number
  }
  outcomes: {
    correctConfidentPass: number
    incorrectConfidentPass: number
    correctConfidentFail: number
    incorrectConfidentFail: number
  }
  pass: ClassMetrics
  fail: ClassMetrics
}

export const calculateExtremeBandMetrics = (
  rows: PredictionEvaluationRow[],
  {
    passAtOrBelow = 0.1,
    failAtOrAbove = 0.9,
  }: {
    passAtOrBelow?: number
    failAtOrAbove?: number
  } = {},
): ExtremeBandMetrics => {
  let confidentPass = 0
  let confidentFail = 0
  let ignoredMiddle = 0
  let actualPass = 0
  let actualFail = 0
  let correctConfidentPass = 0
  let incorrectConfidentPass = 0
  let correctConfidentFail = 0
  let incorrectConfidentFail = 0

  for (const row of rows) {
    if (row.actualDidFail) {
      actualFail += 1
    } else {
      actualPass += 1
    }

    if (row.predictedFailureProbability <= passAtOrBelow) {
      confidentPass += 1
      if (row.actualDidFail) {
        incorrectConfidentPass += 1
      } else {
        correctConfidentPass += 1
      }
      continue
    }

    if (row.predictedFailureProbability >= failAtOrAbove) {
      confidentFail += 1
      if (row.actualDidFail) {
        correctConfidentFail += 1
      } else {
        incorrectConfidentFail += 1
      }
      continue
    }

    ignoredMiddle += 1
  }

  return {
    policy: {
      passAtOrBelow,
      failAtOrAbove,
    },
    totalEvaluated: rows.length,
    coverage: {
      confidentPass,
      confidentFail,
      ignoredMiddle,
      confidentPredictions: confidentPass + confidentFail,
    },
    outcomes: {
      correctConfidentPass,
      incorrectConfidentPass,
      correctConfidentFail,
      incorrectConfidentFail,
    },
    pass: {
      precision: safeDivide(correctConfidentPass, confidentPass),
      recall: safeDivide(correctConfidentPass, actualPass),
    },
    fail: {
      precision: safeDivide(correctConfidentFail, confidentFail),
      recall: safeDivide(correctConfidentFail, actualFail),
    },
  }
}
