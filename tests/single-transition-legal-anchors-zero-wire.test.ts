import { expect, test } from "bun:test"
import { SingleTransitionIntraNodeSolver } from "lib/solvers/HighDensitySolver/SingleTransitionIntraNodeSolver"
import { makeSingleTransitionAnchorNode } from "./fixtures/single-transition-legal-anchors"

test("a legal endpoint anchor preserves the straight wire length and one via", (): void => {
  const node = makeSingleTransitionAnchorNode()
  const solver = new SingleTransitionIntraNodeSolver({ nodeWithPortPoints: node,
    viaDiameter: 0.3, viaPlacementValidator: (placement): boolean => placement.x > 10.12 })
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.iterations).toBe(0)
  const output = solver.solvedRoutes[0]!
  expect(output.vias).toEqual([{ x: 10.125, y: -20 }])
  expect(output.route[0]).toEqual({ x: 9.875, y: -20, z: 0 })
  expect(output.route.at(-1)).toEqual({ x: 10.125, y: -20, z: 3 })
  let wireLength = 0
  for (let index = 1; index < output.route.length; index++) {
    wireLength += Math.hypot(output.route[index]!.x - output.route[index - 1]!.x,
      output.route[index]!.y - output.route[index - 1]!.y)
  }
  expect(wireLength).toBe(0.25)
})
