import { expect, test } from "bun:test"
import type { Node } from "../../lib/data-structures/SingleRouteCandidatePriorityQueue"
import { createDeferredNeighborSolver } from "./createDeferredNeighborSolver"

test("default behavior retains rejected Node observations", () => {
  const solver = createDeferredNeighborSolver(false)
  let reads = 0
  const node: Node = {
    x: 0,
    y: 0,
    z: 0,
    get g(): number {
      reads++
      return 2
    },
    h: 3,
    f: 4,
    parent: null,
  }
  const candidates = solver.getNeighbors({ ...node })
  reads = 0
  for (const candidate of candidates) {
    solver.exploredNodes.add(solver.getNodeKey(candidate))
  }
  expect(solver.getNeighbors(node)).toEqual([])
  expect(reads).toBe(11)
})
