import { expect, test } from "bun:test"
import { createFutureViaNode, createFutureViaSolver, originalFutureViaClearance, readFutureViaMemo } from "tests/fixtures/future-via-memo"

test("custom segment methods and accessors preserve callee binding, one call and threshold-first evaluation", () => {
  for (const useAccessor of [false, true]) {
    const solver = createFutureViaSolver(true)
    const node = createFutureViaNode()
    const segments = solver.getFutureConnectionSegments()
    const events: string[] = []
    for (const [key, value] of [["viaDiameter", 0.3], ["traceThickness", 0.15], ["FUTURE_CONNECTION_VIA_TRACE_CLEARANCE", 0.1]] as const) {
      Object.defineProperty(solver, key, {
        configurable: true,
        get: (): number => { events.push(key); return value },
      })
    }
    const custom = function (this: typeof solver): typeof segments {
      events.push(this === solver ? "bound call" : "wrong receiver")
      return segments
    }
    Object.defineProperty(solver, "getFutureConnectionSegments", useAccessor ? {
      configurable: true,
      get: (): typeof custom => { events.push("callee getter"); return custom },
    } : { configurable: true, value: custom })
    const expected = originalFutureViaClearance(solver, node)
    const expectedEvents = events.splice(0)
    expect(solver.isViaTooCloseToFutureConnectionTrace(node)).toBe(expected)
    expect(events).toEqual(expectedEvents)
    expect(events.slice(0, 3)).toEqual(["viaDiameter", "traceThickness", "FUTURE_CONNECTION_VIA_TRACE_CLEARANCE"])
    expect(readFutureViaMemo(solver)).toBeUndefined()
  }
  const solver = createFutureViaSolver(true)
  const node = createFutureViaNode()
  const original = solver.getFutureConnectionSegments
  let reads = 0
  Object.defineProperty(solver, "getFutureConnectionSegments", {
    get: (): typeof original => { reads++; return original },
  })
  solver.isViaTooCloseToFutureConnectionTrace(node)
  solver.isViaTooCloseToFutureConnectionTrace(node)
  expect(reads).toBe(2)
  expect(readFutureViaMemo(solver)).toBeDefined()
  const empty = createFutureViaSolver(true)
  empty.futureConnectionSegmentsCache = []
  Object.defineProperty(node, "x", { get: (): never => { throw new Error("empty segments must not read coordinates") } })
  expect(empty.isViaTooCloseToFutureConnectionTrace(node)).toBe(false)
  expect(readFutureViaMemo(empty)).toBeUndefined()
})
