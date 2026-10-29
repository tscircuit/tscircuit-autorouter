import { expect, test } from "bun:test"
import { SingleTransitionIntraNodeSolver } from "lib/solvers/HighDensitySolver/SingleTransitionIntraNodeSolver"
import { makeSingleTransitionAnchorNode } from "./fixtures/single-transition-legal-anchors"

test("an invalid original constraint encountered during anchor evaluation remains visible", (): void => {
  const sentinel = new Error("original pad geometry is invalid")
  let queries = 0
  let caught: unknown
  try {
    new SingleTransitionIntraNodeSolver({ nodeWithPortPoints: makeSingleTransitionAnchorNode(),
      viaPlacementValidator: (): boolean => { if (++queries === 1) return false; throw sentinel } })
  } catch (error) {
    caught = error
  }
  expect(queries).toBe(2)
  expect(caught).toBe(sentinel)
})
