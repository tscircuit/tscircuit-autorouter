import { expect, test } from 'bun:test'
import cases from '../fixtures/finite-obstacle-index-legacy-cases.json'
import { findSingleTransitionVia } from '../../lib/solvers/HighDensitySolver/findSingleTransitionVia'

test('raw obstacle indexing preserves exhaustive geometric results across rotation, layers, rules and coordinate frames', () => {
  const before = JSON.stringify(cases)
  expect(cases.rows).toHaveLength(210)
  for (const row of cases.rows) {
    const input = structuredClone(row.input) as Parameters<typeof findSingleTransitionVia>[0]
    const result = findSingleTransitionVia(input)
    if (row.expected === null) expect(result).toBeUndefined()
    else expect(result).toEqual(row.expected)
    if (row.nominalIdentity) expect(result).toBe(input.nominal)
  }
  expect(JSON.stringify(cases)).toBe(before)
})
