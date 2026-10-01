import { expect, test } from "bun:test"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver/GrowShrinkHighDensityIntraNodeSolver"

test("starts a predicted congested node at a routable search scale", () => {
  const solver = new GrowShrinkHighDensityIntraNodeSolver({
    nodeWithPortPoints: {
      capacityMeshNodeId: "congested_node",
      center: { x: 0, y: 0 },
      width: 1.35,
      height: 3,
      availableZ: [0, 1, 2, 3, 4, 5],
      portPoints: [
        { connectionName: "a", x: -0.675, y: -1, z: 0 },
        { connectionName: "a", x: 0.675, y: 1, z: 0 },
      ],
    },
    nodePf: 0.87,
  })

  expect(solver.growthAttempts).toBe(2)
  expect(solver.scaleFactor).toBe(4)

  const ordinaryNodeSolver = new GrowShrinkHighDensityIntraNodeSolver({
    ...solver.getConstructorParams(),
    nodePf: 0.5,
  })
  expect(ordinaryNodeSolver.growthAttempts).toBe(0)
  expect(ordinaryNodeSolver.scaleFactor).toBe(1)
})
