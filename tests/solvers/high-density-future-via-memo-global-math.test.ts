import { expect, test } from "bun:test"
import { createFutureViaNode, createFutureViaSolver, originalFutureViaClearance } from "tests/fixtures/future-via-memo"

test("a global Math accessor retains original reads and cannot be mistaken for the ordinary math object", () => {
  const solver = createFutureViaSolver(true)
  const node = createFutureViaNode(0.05)
  expect(solver.isViaTooCloseToFutureConnectionTrace(node)).toBe(true)
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "Math")!
  const original = Math
  let reads = 0
  let expectedReads = 0
  let actualReads = 0
  let expected: boolean[] = []
  let actual: boolean[] = []
  try {
    Object.defineProperty(globalThis, "Math", {
      configurable: true,
      get: (): Math => { reads++; return original },
    })
    expected = [originalFutureViaClearance(solver, node), originalFutureViaClearance(solver, node)]
    expectedReads = reads
    reads = 0
    actual = [solver.isViaTooCloseToFutureConnectionTrace(node), solver.isViaTooCloseToFutureConnectionTrace(node)]
    actualReads = reads
  } finally {
    Object.defineProperty(globalThis, "Math", descriptor)
  }
  expect(actual).toEqual(expected)
  expect(expectedReads).toBe(6)
  expect(actualReads).toBe(expectedReads)
})
