import { expect, test } from "bun:test"
import { createFutureViaNode, createFutureViaSolver, originalFutureViaClearance } from "tests/fixtures/future-via-memo"

test("patched Math methods and accessors retain original calls on previously memoized coordinates", () => {
  for (const key of ["min", "max", "sqrt"] as const) {
    for (const accessor of [false, true]) {
      const solver = createFutureViaSolver(true)
      const node = createFutureViaNode(0.05)
      expect(solver.isViaTooCloseToFutureConnectionTrace(node)).toBe(true)
      const descriptor = Object.getOwnPropertyDescriptor(Math, key)!
      const original = Math[key]
      const events: string[] = []
      const custom = (...args: number[]): number => {
        events.push(`call ${key}`)
        return key === "sqrt" ? 10 : Reflect.apply(original, Math, args)
      }
      const replacement = accessor ? {
        configurable: true,
        get: (): typeof custom => { events.push(`get ${key}`); return custom },
      } : { configurable: true, writable: true, value: custom }
      let expected: boolean[] = []
      let actual: boolean[] = []
      let expectedEvents: string[] = []
      let actualEvents: string[] = []
      try {
        Object.defineProperty(Math, key, replacement)
        expected = [originalFutureViaClearance(solver, node), originalFutureViaClearance(solver, node)]
        expectedEvents = events.splice(0)
        actual = [solver.isViaTooCloseToFutureConnectionTrace(node), solver.isViaTooCloseToFutureConnectionTrace(node)]
        actualEvents = events.splice(0)
      } finally {
        Object.defineProperty(Math, key, descriptor)
      }
      expect(actual).toEqual(expected)
      expect(actualEvents).toEqual(expectedEvents)
      expect(actualEvents.length).toBeGreaterThan(0)
      expect(solver.isViaTooCloseToFutureConnectionTrace(node)).toBe(true)
    }
  }
})
