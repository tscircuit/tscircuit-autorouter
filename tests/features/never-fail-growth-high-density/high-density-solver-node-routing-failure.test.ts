import { expect, test } from "bun:test"
import { HighDensitySolver } from "lib/solvers/HighDensitySolver/HighDensitySolver"
import { makeCrossingSingleLayerNode } from "./test-helpers"

test("HighDensitySolver exposes a structured node-routing failure", () => {
  const solver = new HighDensitySolver({
    nodePortPoints: [makeCrossingSingleLayerNode()],
    useGrowShrinkHighDensityIntraNodeSolver: true,
  })

  solver.solve()

  expect(solver.solved).toBe(false)
  expect(solver.failed).toBe(true)
  expect(solver.routes).toHaveLength(0)
  expect(solver.nodeRoutingFailures).toEqual([
    {
      type: "high_density_node_routing_failure",
      capacityMeshNodeId: "cn_crossing",
      reason: "single_layer_crossing",
      growthAttempts: 0,
      scaleFactor: 1,
      lastError: "single-layer port order requires routes to cross",
    },
  ])
  expect(
    solver.nodeSolveMetadataById.get("cn_crossing")?.nodeRoutingFailure,
  ).toEqual({
    type: "high_density_node_routing_failure",
    capacityMeshNodeId: "cn_crossing",
    reason: "single_layer_crossing",
    growthAttempts: 0,
    scaleFactor: 1,
    lastError: "single-layer port order requires routes to cross",
  })
  expect(solver.error).toContain("cn_crossing")
})
