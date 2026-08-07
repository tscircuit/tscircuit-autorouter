import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import { makeCrossingSingleLayerNode } from "./test-helpers"

test("GrowShrinkHighDensityIntraNodeSolver rejects impossible single-layer crossings", () => {
  const solver = new GrowShrinkHighDensityIntraNodeSolver({
    nodeWithPortPoints: makeCrossingSingleLayerNode(),
  })

  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.activeSubSolver).toBeNull()
  expect(solver.growthAttempts).toBe(0)
  expect(solver.iterations).toBe(0)
  expect(solver.nodeRoutingFailure).toEqual({
    type: "high_density_node_routing_failure",
    capacityMeshNodeId: "cn_crossing",
    reason: "single_layer_crossing",
    growthAttempts: 0,
    scaleFactor: 1,
    lastError: "single-layer port order requires routes to cross",
  })
  expect(solver.solvedRoutes).toHaveLength(0)
  expect(solver.visualize().lines).toHaveLength(0)
  expect(getSvgFromGraphicsObject(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})
