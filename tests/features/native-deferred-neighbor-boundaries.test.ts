import { expect, test } from "bun:test"
import type { Node } from "../../lib/data-structures/SingleRouteCandidatePriorityQueue"
import { createDeferredNeighborSolver } from "./createDeferredNeighborSolver"

test("deferred neighbors preserve grid aliases and clamp edges", () => {
  const positions = [
    -1, -0.9999999999999999, -0.075, -0.025, -0, 0, 0.025, 0.075,
    0.9999999999999999, 1,
  ]
  let comparisons = 0
  for (const cellStep of [0.05, 0.1, 0.3, Number.NaN, Infinity]) {
    for (const x of positions) {
      for (const y of positions) {
        const legacy = createDeferredNeighborSolver(false)
        const deferred = createDeferredNeighborSolver(true)
        legacy.cellStep = deferred.cellStep = cellStep
        const node: Node = {
          x,
          y,
          z: comparisons % 4,
          g: 1,
          h: 2,
          f: 3,
          parent: null,
        }
        const original = legacy.getNeighbors(node)
        expect(deferred.getNeighbors(node)).toEqual(original)
        for (let i = 0; i < original.length; i += 2) {
          const key = legacy.getNodeKey(original[i])
          legacy.exploredNodes.add(key)
          deferred.exploredNodes.add(key)
        }
        const expected = legacy.getNeighbors(node)
        const actual = deferred.getNeighbors(node)
        expect(actual).toEqual(expected)
        expect([...deferred.exploredNodes]).toEqual([...legacy.exploredNodes])
        expect([...deferred.debug_nodesTooCloseToObstacle]).toEqual([
          ...legacy.debug_nodesTooCloseToObstacle,
        ])
        expect([...deferred.debug_nodePathToParentIntersectsObstacle]).toEqual([
          ...legacy.debug_nodePathToParentIntersectsObstacle,
        ])
        for (let i = 0; i < actual.length; i++) {
          expect(actual[i].parent).toBe(node)
          expect(Object.is(actual[i].x, expected[i].x)).toBe(true)
          expect(Object.is(actual[i].y, expected[i].y)).toBe(true)
        }
        comparisons++
      }
    }
  }
  expect(comparisons).toBe(500)
})
