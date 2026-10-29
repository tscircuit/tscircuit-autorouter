import { expect, test } from "bun:test"
import { SingleTransitionIntraNodeSolver } from "lib/solvers/HighDensitySolver/SingleTransitionIntraNodeSolver"
import type { ViaPlacement } from "lib/types/high-density-types"
import { makeSingleTransitionAnchorNode } from "./fixtures/single-transition-legal-anchors"

test("no legal bounded anchor retains the existing visible closed-form failure", (): void => {
  const node = makeSingleTransitionAnchorNode()
  node.portPoints[0]!.x -= 0.01
  const observed: ViaPlacement[] = []
  const solver = new SingleTransitionIntraNodeSolver({ nodeWithPortPoints: node,
    viaPlacementValidator: (placement): boolean => { observed.push({ ...placement }); return false } })
  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.error).toBe("Closed-form via placement violates original board constraints")
  expect(solver.solvedRoutes).toEqual([])
  expect(solver.iterations).toBe(0)
  expect(observed.length).toBe(10)
  expect(observed.every(({ x, y }) => x >= 9.875 && x <= 10.125 && y >= -20.125 && y <= -19.875)).toBe(true)
})
