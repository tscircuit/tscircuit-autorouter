import { expect, test } from "bun:test"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { generateColorMapFromNodeWithPortPoints } from "lib/utils/generateColorMapFromNodeWithPortPoints"
import cmn3Node from "../../fixtures/features/high-density-future-cost/high-density-future-cost-cmn3-pipeline4-circuit003-node.json" with {
  type: "json",
}

test("SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost - cmn_3 pipeline4 circuit003 repro", () => {
  const nodeWithPortPoints = cmn3Node
  const solver = new IntraNodeRouteSolver({
    nodeWithPortPoints: nodeWithPortPoints as any,
    colorMap: generateColorMapFromNodeWithPortPoints(nodeWithPortPoints as any),
    hyperParameters: {
      SHUFFLE_SEED: 1,
    },
  })

  solver.solve()

  expect(solver.solved || solver.failed).toBe(true)
  expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path)
})
