import { expect, test } from "bun:test"
import { SingleTransitionIntraNodeSolver } from "lib/solvers/HighDensitySolver/SingleTransitionIntraNodeSolver"
import { makeSingleTransitionAnchorNode } from "./fixtures/single-transition-legal-anchors"

test("anchor selection minimizes wire length with deterministic geometric ties", (): void => {
  const node = makeSingleTransitionAnchorNode()
  node.width = 2
  node.height = 2
  node.portPoints[0]!.x = 9
  node.portPoints[1]!.x = 11
  const params = { nodeWithPortPoints: node, viaDiameter: 0.3,
    viaPlacementValidator: (placement: { y: number }): boolean => placement.y !== -20 }
  const solver = new SingleTransitionIntraNodeSolver(params)
  const repeated = new SingleTransitionIntraNodeSolver(params)
  expect(solver.solved).toBe(true)
  expect(solver.solvedRoutes[0]!.vias).toEqual([{ x: 10, y: -21 }])
  expect(repeated.solvedRoutes).toEqual(solver.solvedRoutes)
  const via = solver.solvedRoutes[0]!.vias[0]!
  expect(Math.hypot(via.x - 9, via.y + 20) + Math.hypot(via.x - 11, via.y + 20))
    .toBeCloseTo(2 * Math.SQRT2, 12)
})
