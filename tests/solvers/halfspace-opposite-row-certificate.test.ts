import { expect, test } from "bun:test"
import { HalfspaceProjectionSolver, type LinearHalfspace } from "lib/solvers/HalfspaceProjectionSolver"
import { getOppositeRowCertificate } from "lib/solvers/getOppositeRowCertificate"

test("only exact opposite finite rows certify a selected choice, including the captured tiny contradiction", (): void => {
  for (const coefficients of [[1, 0], [0, 1], [1, 1], [1, -1], [2, 0.5]]) {
    for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
      const rows: LinearHalfspace[] = [{
        terms: coefficients.map((coefficient, variable) => ({ coefficient, variable })), maximum: a, family: 1,
      }, {
        terms: coefficients.map((coefficient, variable) => ({ coefficient: -coefficient, variable })).reverse(), maximum: b, family: 2,
      }]
      const certificate = getOppositeRowCertificate(rows, 0, 1)
      expect(Boolean(certificate)).toBe(a + b < 0)
      if (certificate) {
        expect(certificate.boundSum).toBe(a + b)
        expect(certificate.families).toEqual([1, 2])
      }
    }
  }
  const tiny: LinearHalfspace[] = [{
    terms: [{ variable: 6, coefficient: -1 }], maximum: -0.03108284901807365, family: 108,
  }, {
    terms: [{ variable: 6, coefficient: 1 }], maximum: -0.018919150981926397, family: 113,
  }]
  const solver = new HalfspaceProjectionSolver(15, tiny, 0)
  solver.solve()
  const result = solver.getOutput()
  expect(result.status).toBe("contradictory-choice")
  if (result.status === "contradictory-choice") {
    const checked = getOppositeRowCertificate(tiny, 0, 1)
    if (!checked) throw new Error("Expected exact captured contradiction")
    expect(result.certificate).toEqual(checked)
    expect(result.certificate.families).toEqual([108, 113])
  }
  expect(solver.constraintChecks).toBe(0)
  expect(solver.stats.preprocessingRows).toBe(2)
  expect(solver.stats.rowUpdates).toBe(0)
  expect(solver.stats.exactRowChecks).toBe(1)
  const mismatched = structuredClone(tiny)
  mismatched[1]!.terms[0]!.coefficient = 1 + Number.EPSILON
  expect(getOppositeRowCertificate(mismatched, 0, 1)).toBeUndefined()
  mismatched[1]!.terms[0] = { variable: 7, coefficient: 1 }
  expect(getOppositeRowCertificate(mismatched, 0, 1)).toBeUndefined()
  for (const maxima of [[-1e-10, -1e-10], [-1e-12, 0], [Number.MAX_VALUE, -Number.MAX_VALUE], [-Number.MAX_VALUE, -Number.MAX_VALUE], [NaN, -1], [-1, Infinity]]) {
    const rows = structuredClone(tiny)
    rows[0]!.maximum = maxima[0]!
    rows[1]!.maximum = maxima[1]!
    expect(getOppositeRowCertificate(rows, 0, 1)).toBeUndefined()
  }
  for (const coefficient of [NaN, Infinity]) {
    const rows = structuredClone(tiny)
    rows[1]!.terms[0]!.coefficient = coefficient
    expect(getOppositeRowCertificate(rows, 0, 1)).toBeUndefined()
  }
  const zeroTerms = structuredClone(tiny)
  zeroTerms[0]!.terms.push({ variable: 0, coefficient: -0 })
  zeroTerms[1]!.terms.push({ variable: 1, coefficient: 0 })
  expect(getOppositeRowCertificate(zeroTerms, 0, 1)?.boundSum).toBeLessThan(0)
  const duplicates = structuredClone(tiny)
  duplicates[0]!.terms.push({ variable: 6, coefficient: 0 })
  expect(getOppositeRowCertificate(duplicates, 0, 1)).toBeUndefined()
  const noFamilies = tiny.map(({ family, ...row }): LinearHalfspace => row)
  expect(getOppositeRowCertificate(noFamilies, 0, 1)?.families).toEqual([])
  expect(getOppositeRowCertificate(tiny, 0, 0)).toBeUndefined()
  expect(getOppositeRowCertificate(tiny, -1, 1)).toBeUndefined()
  expect(getOppositeRowCertificate(tiny, 0, 2)).toBeUndefined()
})
