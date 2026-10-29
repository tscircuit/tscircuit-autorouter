import { expect, test } from "bun:test"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { makeLazyHdPortfolio, makeLazyHdSyntheticNode } from "./fixtures/lazyHdSynthetic"

const freezeAttemptGeometry = (node: NodeWithPortPoints): void => {
  for (const point of node.portPoints) Object.freeze(point)
  for (const pair of node.portPointsInPairs ?? []) {
    for (const point of pair) Object.freeze(point)
    Object.freeze(pair)
  }
  if (node.portPointsInPairs) Object.freeze(node.portPointsInPairs)
  if (node.availableZ) Object.freeze(node.availableZ)
  Object.freeze(node.center)
  Object.freeze(node.portPoints)
  Object.freeze(node)
}

test("every admitted sibling and adaptive seed leaves its owned attempt geometry unchanged", () => {
  let candidatesExercised = 0
  for (const priority of [false, true]) {
    for (const flag of [false, true]) {
      for (const seed of [1, 2, 5]) {
        const portfolio = makeLazyHdPortfolio(makeLazyHdSyntheticNode(seed), flag, priority)
        const before = structuredClone(portfolio.nodeWithPortPoints)
        freezeAttemptGeometry(portfolio.nodeWithPortPoints)
        portfolio.initializeSolvers()
        ;(portfolio as any).expandAdaptiveSearch()
        expect(portfolio.supervisedSolvers!.length).toBe(priority ? 22 : 76)
        for (const { solver } of portfolio.supervisedSolvers!) {
          for (let step = 0; step < 32 && !solver.solved && !solver.failed; step++) solver.step()
          expect(portfolio.nodeWithPortPoints).toEqual(before)
          candidatesExercised++
        }
      }
    }
  }
  expect(candidatesExercised).toBe(588)
})
