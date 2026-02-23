import { expect, test } from "bun:test"
import { FixedTopologyHighDensityIntraNodeSolver } from "lib/solvers/FixedTopologyHighDensityIntraNodeSolver"
import input01 from "../../fixtures/features/via-high-density/via-high-density01-input.json" with {
  type: "json",
}
test("FixedTopologyHighDensityIntraNodeSolver01 - basic two crossing connections", () => {
  const solver = new FixedTopologyHighDensityIntraNodeSolver({
    nodeWithPortPoints: input01.nodeWithPortPoints as any,
    colorMap: input01.colorMap,
    traceWidth: input01.traceWidth,
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
