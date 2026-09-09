import { expect, test } from "bun:test"
import { createFutureViaNode, createFutureViaSolver, originalFutureViaClearance, readFutureViaMemo } from "tests/fixtures/future-via-memo"

test("future clearance reuses one exact-coordinate record across layers and handles numeric and geometry changes", () => {
  for (const layers of [2, 4, 6]) {
    const solver = createFutureViaSolver(true, layers)
    const node = createFutureViaNode(0.05)
    expect(solver.isViaTooCloseToFutureConnectionTrace(node)).toBe(true)
    const memo = readFutureViaMemo(solver)
    if (layers === 2) {
      expect(memo).toBeUndefined()
    } else {
      expect(memo).toBeDefined()
      expect(Object.keys(memo!).sort()).toEqual(["segments", "threshold", "tooClose", "x", "y"])
      // A getter on the private result proves the hit branch executes without
      // patching a guarded geometry function or retaining a Node/parent chain.
      let hits = 0
      const result = memo!.tooClose
      Object.defineProperty(memo!, "tooClose", {
        configurable: true,
        get: (): boolean => { hits++; return result },
      })
      const otherLayer = { ...node, z: layers - 1, parent: createFutureViaNode(9, 9) }
      expect(solver.isViaTooCloseToFutureConnectionTrace(otherLayer)).toBe(result)
      expect(hits).toBe(1)
      Object.defineProperty(memo!, "tooClose", { configurable: true, writable: true, value: result })
    }
    const threshold = solver.viaDiameter / 2 + solver.traceThickness / 2 + solver.FUTURE_CONNECTION_VIA_TRACE_CLEARANCE
    const inside = createFutureViaNode(threshold - 1e-10)
    const outside = createFutureViaNode(threshold + 1e-10)
    expect(solver.getNodeKey(inside)).toBe(solver.getNodeKey(outside))
    expect(solver.isViaTooCloseToFutureConnectionTrace(inside)).toBe(true)
    expect(solver.isViaTooCloseToFutureConnectionTrace(outside)).toBe(false)
    for (const x of [0, -0, 1e-300, -1e-300, 2, -2, NaN, Infinity, -Infinity]) {
      for (const clearance of [0, -0, 0.1, -0.5, NaN, Infinity, -Infinity]) {
        solver.FUTURE_CONNECTION_VIA_TRACE_CLEARANCE = clearance
        const query = createFutureViaNode(x)
        const expected = originalFutureViaClearance(solver, query)
        expect(solver.isViaTooCloseToFutureConnectionTrace(query)).toBe(expected)
        expect(solver.isViaTooCloseToFutureConnectionTrace({ ...query, z: layers - 1 })).toBe(expected)
      }
    }
    solver.FUTURE_CONNECTION_VIA_TRACE_CLEARANCE = 0.1
    for (const [via, width] of [[0.3, 0.15], [2, 0.15], [0.3, 2], [0.3, 0.15]]) {
      solver.viaDiameter = via
      solver.traceThickness = width
      const query = createFutureViaNode(0.8)
      expect(solver.isViaTooCloseToFutureConnectionTrace(query)).toBe(originalFutureViaClearance(solver, query))
    }
    const oldSegments = solver.getFutureConnectionSegments()
    solver.futureConnectionSegmentsCache = [{
      connectionName: "replacement", start: { x: 1, y: -1, z: 0 }, end: { x: 1, y: 1, z: 1 },
    }]
    expect(solver.isViaTooCloseToFutureConnectionTrace(node)).toBe(false)
    solver.futureConnectionSegmentsCache = null
    expect(solver.isViaTooCloseToFutureConnectionTrace(node)).toBe(true)
    expect(solver.getFutureConnectionSegments()).not.toBe(oldSegments)
    if (memo) expect(readFutureViaMemo(solver)).toBe(memo)
  }
})
