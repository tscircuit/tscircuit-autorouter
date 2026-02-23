import { expect, test } from "bun:test"
import { FixedTopologyHighDensityIntraNodeSolver } from "lib/solvers/FixedTopologyHighDensityIntraNodeSolver"
import input03 from "../../fixtures/features/via-high-density/via-high-density03-input.json" with {
  type: "json",
}

test("FixedTopologyHighDensityIntraNodeSolver03 - four connections with shuffle seed", () => {
  const solver = new FixedTopologyHighDensityIntraNodeSolver({
    nodeWithPortPoints: input03.nodeWithPortPoints as any,
    colorMap: input03.colorMap,
    traceWidth: input03.traceWidth,
  })

  solver.solve()

  expect(solver.solved || solver.failed).toBe(true)

  if (solver.solved) {
    // Verify routes were created
    expect(solver.solvedRoutes.length).toBeGreaterThan(0)

    // Verify unused vias are filtered out
    const outputVias = solver.getOutputVias()
    for (const via of outputVias) {
      expect(via.connectedTo.length).toBeGreaterThan(0)
    }
  }

  expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path)
})
