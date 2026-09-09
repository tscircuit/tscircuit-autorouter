import { expect, test } from "bun:test"
import { createFutureViaNode, createFutureViaSolver, originalFutureViaClearance, readFutureViaMemo } from "tests/fixtures/future-via-memo"

test("ordinary public future clearance preserves mutable geometry and getter evaluation without opting in", () => {
  for (const layers of [2, 4, 6]) {
    const solver = createFutureViaSolver(false, layers)
    const node = createFutureViaNode()
    const segment = solver.getFutureConnectionSegments()[0]
    expect(solver.isViaTooCloseToFutureConnectionTrace(node)).toBe(true)
    segment.start.x = segment.end.x = 1
    expect(solver.isViaTooCloseToFutureConnectionTrace(node)).toBe(false)
    const events: string[] = []
    for (const [object, key, label] of [
      [solver, "viaDiameter", "via"], [solver, "traceThickness", "width"],
      [solver, "FUTURE_CONNECTION_VIA_TRACE_CLEARANCE", "clearance"],
      [node, "x", "node.x"], [node, "y", "node.y"],
      [segment.start, "x", "start.x"], [segment.end, "x", "end.x"],
    ] as const) {
      const value = Reflect.get(object, key)
      Object.defineProperty(object, key, {
        configurable: true,
        get: (): unknown => { events.push(label); return value },
      })
    }
    const original = solver.getFutureConnectionSegments
    Object.defineProperty(solver, "getFutureConnectionSegments", {
      get: (): typeof original => { events.push("method"); return original },
    })
    const expected = originalFutureViaClearance(solver, node)
    const expectedEvents = events.splice(0)
    expect(solver.isViaTooCloseToFutureConnectionTrace(node)).toBe(expected)
    expect(events).toEqual(expectedEvents)
    expect(events.slice(0, 4)).toEqual(["via", "width", "clearance", "method"])
    expect(readFutureViaMemo(solver)).toBeUndefined()
    solver.futureConnectionSegmentsCache = []
    events.length = 0
    expect(solver.isViaTooCloseToFutureConnectionTrace(node)).toBe(false)
    expect(events).toEqual(["via", "width", "clearance", "method"])
  }
})
