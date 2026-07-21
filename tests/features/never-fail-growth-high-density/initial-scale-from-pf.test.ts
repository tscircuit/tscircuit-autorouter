import { expect, test } from "bun:test"
import { HighDensitySolver } from "lib/solvers/HighDensitySolver/HighDensitySolver"
import {
  getInitialScaleFactorForNodePf,
  GrowShrinkHighDensityIntraNodeSolver,
} from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import { makeCrossingSingleLayerNode, makeNode } from "./test-helpers"

test("initial grow/shrink scale is derived from estimated capacity pressure", () => {
  expect(getInitialScaleFactorForNodePf(null)).toBe(1)
  expect(getInitialScaleFactorForNodePf(0.5)).toBe(1)
  expect(getInitialScaleFactorForNodePf(0.51)).toBe(2)
  expect(getInitialScaleFactorForNodePf(2)).toBe(2)
  expect(getInitialScaleFactorForNodePf(2.01)).toBe(4)
  expect(getInitialScaleFactorForNodePf(100)).toBe(8)
})

test("cramped metadata does not pre-grow a low-pressure node", () => {
  const node = makeNode()
  node.portPoints[0]!.cramped = true
  const solver = new HighDensitySolver({
    nodePortPoints: [node],
    useGrowShrinkHighDensityIntraNodeSolver: true,
  })

  solver.step()

  expect(solver.nodePfById.get(node.capacityMeshNodeId)).toBe(0)
  expect(
    (solver.activeSubSolver as GrowShrinkHighDensityIntraNodeSolver)
      .scaleFactor,
  ).toBe(1)
})

test("HighDensitySolver starts an over-capacity node at its derived scale", () => {
  const node = makeNode()
  const solver = new HighDensitySolver({
    nodePortPoints: [node],
    nodePfById: new Map([[node.capacityMeshNodeId, 1.99]]),
    useGrowShrinkHighDensityIntraNodeSolver: true,
  })

  solver.step()

  expect(solver.activeSubSolver).toBeInstanceOf(
    GrowShrinkHighDensityIntraNodeSolver,
  )
  expect(
    (solver.activeSubSolver as GrowShrinkHighDensityIntraNodeSolver)
      .scaleFactor,
  ).toBe(2)
  expect(
    (solver.activeSubSolver as GrowShrinkHighDensityIntraNodeSolver)
      .growthAttempts,
  ).toBe(1)
})

test("HighDensitySolver computes pressure from the node it actually solves", () => {
  const node = makeCrossingSingleLayerNode()
  const solver = new HighDensitySolver({
    nodePortPoints: [node],
    useGrowShrinkHighDensityIntraNodeSolver: true,
  })

  solver.step()

  expect(solver.nodePfById.get(node.capacityMeshNodeId)).toBe(1)
  expect(
    (solver.activeSubSolver as GrowShrinkHighDensityIntraNodeSolver)
      .scaleFactor,
  ).toBe(2)
})
