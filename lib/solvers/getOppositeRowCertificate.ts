import type { LinearHalfspace } from "./HalfspaceProjectionSolver"

export type OppositeRowCertificate = {
  rows: [number, number]
  families: number[]
  boundSum: number
}

export type OppositeRowCheckStats = {
  rowChecks: number
  termReads: number
  termComparisons: number
  sortComparisons: number
}

/** Check an exact two-row contradiction within the supplied finite model. */
export const getOppositeRowCertificate = (
  constraints: readonly LinearHalfspace[], first: number, second: number,
  tolerance = 1e-10, stats?: OppositeRowCheckStats,
): OppositeRowCertificate | undefined => {
  if (stats) stats.rowChecks++
  if (
    !Number.isSafeInteger(first) || !Number.isSafeInteger(second) ||
    first < 0 || second < 0 || first === second ||
    first >= constraints.length || second >= constraints.length ||
    !Number.isFinite(tolerance) || tolerance < 0
  ) return undefined
  const a = constraints[first]!, b = constraints[second]!
  if (!Number.isFinite(a.maximum) || !Number.isFinite(b.maximum)) return undefined
  const boundSum = a.maximum + b.maximum
  const roundoff = Number.EPSILON * 4 * (Math.abs(a.maximum) + Math.abs(b.maximum) + 1)
  if (!Number.isFinite(boundSum) || !Number.isFinite(roundoff) || !(boundSum < -2 * tolerance - roundoff)) return undefined
  const canonical: LinearHalfspace["terms"][] = []
  for (const row of [a, b]) {
    const seen = new Set<number>()
    const terms: LinearHalfspace["terms"] = []
    if (row.family !== undefined && (!Number.isSafeInteger(row.family) || row.family < 0)) return undefined
    for (const term of row.terms) {
      if (stats) stats.termReads++
      if (
        !Number.isSafeInteger(term.variable) || term.variable < 0 ||
        !Number.isFinite(term.coefficient) || seen.has(term.variable)
      ) return undefined
      seen.add(term.variable)
      if (term.coefficient !== 0) terms.push(term)
    }
    terms.sort((x, y): number => {
      if (stats) stats.sortComparisons++
      return x.variable - y.variable
    })
    canonical.push(terms)
  }
  const [left, right] = canonical as [LinearHalfspace["terms"], LinearHalfspace["terms"]]
  if (left.length !== right.length) return undefined
  for (let index = 0; index < left.length; index++) {
    if (stats) stats.termComparisons++
    if (
      left[index]!.variable !== right[index]!.variable ||
      left[index]!.coefficient !== -right[index]!.coefficient
    ) return undefined
  }
  // Exact opposite binary coefficients cancel as real values. The bound sum
  // must be strictly negative beyond both solver tolerance and addition error.
  return {
    rows: [first, second],
    families: [...new Set([a.family, b.family].filter((family): family is number => family !== undefined))],
    boundSum,
  }
}
