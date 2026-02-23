import { expect, test } from "bun:test"
import { FixedTopologyHighDensityIntraNodeSolver } from "lib/solvers/FixedTopologyHighDensityIntraNodeSolver"
import input02 from "../../fixtures/features/via-high-density/via-high-density02-input.json" with {
  type: "json",
}

test("FixedTopologyHighDensityIntraNodeSolver02 - three connections with custom tile size", () => {
  const solver = new FixedTopologyHighDensityIntraNodeSolver({
    nodeWithPortPoints: input02.nodeWithPortPoints as any,
    colorMap: input02.colorMap,
    traceWidth: input02.traceWidth,
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
