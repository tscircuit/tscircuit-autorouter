import { expect, test } from "bun:test"
import type { Node } from "../../lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver } from "../../lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import { createDeferredNeighborSolver } from "./createDeferredNeighborSolver"

test("deferred neighbors preserve custom key hooks", () => {
  const original = SingleHighDensityRouteSolver.prototype.getNodeKey
  const node: Node = { x: 0.1, y: -0.2, z: 0, g: 5, h: 6, f: 7, parent: null }
  for (const globalOverride of [false, true]) {
    const calls: Node[][] = [[], []]
    const solvers = [
      createDeferredNeighborSolver(false),
      createDeferredNeighborSolver(true),
    ]
    try {
      if (globalOverride) {
        SingleHighDensityRouteSolver.prototype.getNodeKey = function (
          this: SingleHighDensityRouteSolver,
          neighbor: Node,
        ): number {
          calls[solvers.indexOf(this)].push({ ...neighbor })
          return original.call(this, neighbor) + neighbor.g
        }
      } else {
        for (let i = 0; i < solvers.length; i++) {
          const solver = solvers[i]
          solver.getNodeKey = function (neighbor: Node): number {
            calls[i].push({ ...neighbor })
            return original.call(this, neighbor) + neighbor.g
          }
        }
      }
      expect(solvers[1].getNeighbors(node)).toEqual(
        solvers[0].getNeighbors(node),
      )
      expect(calls[1]).toEqual(calls[0])
      expect(calls[1].length).toBeGreaterThan(8)
      for (const observed of calls[1]) {
        expect(observed.g).toBe(5)
        expect(observed.h).toBe(6)
        expect(observed.f).toBe(7)
        expect(observed.parent).toBe(node)
      }
    } finally {
      SingleHighDensityRouteSolver.prototype.getNodeKey = original
    }
  }
})
