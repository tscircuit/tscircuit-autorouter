import { expect, test } from "bun:test"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import { emptyVisualization, makeNode, makeScaledRoute } from "./test-helpers"

test("GrowShrinkHighDensityIntraNodeSolver shrinks solved routes back to the original node", () => {
  const solver = new GrowShrinkHighDensityIntraNodeSolver({
    nodeWithPortPoints: makeNode(),
  })
  solver.scaleFactor = 2

  solver.activeSubSolver = {
    failed: false,
    solved: false,
    error: null,
    solvedRoutes: [makeScaledRoute()],
    step() {
      this.solved = true
    },
    visualize: emptyVisualization,
  } as any

  solver.step()

  expect(solver.solved).toBe(true)
  expect(solver.solvedRoutes[0].route).toEqual([
    { x: 9.5, y: 20, z: 0 },
    { x: 10, y: 21, z: 0 },
    { x: 10.5, y: 20, z: 0 },
  ])
  expect(solver.solvedRoutes[0].vias).toEqual([{ x: 10, y: 21 }])
})
