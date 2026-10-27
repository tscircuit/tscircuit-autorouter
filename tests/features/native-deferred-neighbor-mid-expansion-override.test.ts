import { expect, test } from "bun:test"
import type { Node } from "../../lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver } from "../../lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import { createDeferredNeighborSolver } from "./createDeferredNeighborSolver"

test("key overrides installed during expansion take effect", () => {
  const solvers = [
    createDeferredNeighborSolver(false),
    createDeferredNeighborSolver(true),
  ]
  const calls: Node[][] = [[], []]
  const original = SingleHighDensityRouteSolver.prototype.getNodeKey
  const node: Node = { x: 0.1, y: 0.2, z: 0, g: 2, h: 3, f: 4, parent: null }
  for (let i = 0; i < solvers.length; i++) {
    const solver = solvers[i]
    const setCosts = solver.setNodeCosts.bind(solver)
    solver.setNodeCosts = (neighbor: Node): void => {
      setCosts(neighbor)
      solver.getNodeKey = (next: Node): number => {
        calls[i].push({ ...next })
        return original.call(solver, next) + 0.25
      }
    }
  }
  expect(solvers[1].getNeighbors(node)).toEqual(solvers[0].getNeighbors(node))
  expect(calls[1]).toEqual(calls[0])
  expect(calls[1].length).toBeGreaterThan(0)
})
