import { expect, test } from "bun:test"
import { SingleHighDensityRouteSolver as Base } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as Solver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import { createFutureViaNode, createFutureViaSolver, originalFutureViaClearance, readFutureViaMemo } from "tests/fixtures/future-via-memo"

test("custom node-generation functions and accessors decline future clearance memoization without extra dispatch", () => {
  for (const location of ["own", "base", "derived"] as const) {
    for (const accessor of [false, true]) {
      const solver = createFutureViaSolver(true)
      const node = createFutureViaNode(0.05)
      const owner = location === "own" ? solver : location === "base" ? Base.prototype : Solver.prototype
      const original = solver.getNeighbors
      const descriptor = Object.getOwnPropertyDescriptor(owner, "getNeighbors")
      const events: string[] = []
      const custom = function (this: Solver, ...args: Parameters<Solver["getNeighbors"]>): ReturnType<Solver["getNeighbors"]> {
        events.push("generation call")
        return Reflect.apply(original, this, args)
      }
      Object.defineProperty(owner, "getNeighbors", accessor ? {
        configurable: true,
        get: (): typeof custom => { events.push("generation getter"); return custom },
      } : { configurable: true, writable: true, value: custom })
      try {
        expect(solver.isViaTooCloseToFutureConnectionTrace(node)).toBe(originalFutureViaClearance(solver, node))
        expect(solver.isViaTooCloseToFutureConnectionTrace(node)).toBe(originalFutureViaClearance(solver, node))
        expect(events).toEqual([])
        expect(readFutureViaMemo(solver)).toBeUndefined()
      } finally {
        if (descriptor) Object.defineProperty(owner, "getNeighbors", descriptor)
        else Reflect.deleteProperty(owner, "getNeighbors")
      }
    }
  }
})
