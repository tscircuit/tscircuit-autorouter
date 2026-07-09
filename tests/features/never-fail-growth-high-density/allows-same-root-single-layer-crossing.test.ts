import { expect, test } from "bun:test"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import { makeCrossingSingleLayerNode } from "./test-helpers"

test("GrowShrinkHighDensityIntraNodeSolver does not reject same-root single-layer crossings", () => {
  const nodeWithPortPoints = makeCrossingSingleLayerNode()
  nodeWithPortPoints.portPoints = nodeWithPortPoints.portPoints.map(
    (portPoint) => ({
      ...portPoint,
      rootConnectionName: "source_net_1",
    }),
  )

  const solver = new GrowShrinkHighDensityIntraNodeSolver({
    nodeWithPortPoints,
  })

  expect(solver.failed).toBe(false)
  expect(solver.error).toBeNull()
  expect(solver.stats.impossibleGeometry).toBeUndefined()
})
