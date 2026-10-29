import { expect, test } from "bun:test"
import { SingleTransitionIntraNodeSolver } from "lib/solvers/HighDensitySolver/SingleTransitionIntraNodeSolver"
import { makeSingleTransitionAnchorNode } from "./fixtures/single-transition-legal-anchors"

test("an accepted midpoint and an undefined validator preserve the existing output and work", (): void => {
  const node = makeSingleTransitionAnchorNode()
  const originalNode = structuredClone(node)
  let queries = 0
  const legacy = new SingleTransitionIntraNodeSolver({ nodeWithPortPoints: node })
  const allowed = new SingleTransitionIntraNodeSolver({ nodeWithPortPoints: node,
    viaPlacementValidator: (): boolean => { queries++; return true } })
  expect(queries).toBe(1)
  expect(legacy.solved).toBe(true)
  expect(allowed.solvedRoutes).toEqual(legacy.solvedRoutes)
  expect(allowed.solvedRoutes[0]!.vias).toEqual([{ x: 10, y: -20 }])
  expect(allowed.iterations).toBe(legacy.iterations)
  expect(allowed.MAX_ITERATIONS).toBe(legacy.MAX_ITERATIONS)
  expect(node).toEqual(originalNode)
})
