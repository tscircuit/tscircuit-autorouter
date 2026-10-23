import { expect, test } from "bun:test"
import { HighDensitySolverA13 } from "@tscircuit/high-density-a13"
import { ContextualComputeSelectionModel } from "lib/solvers/HyperHighDensitySolver/ContextualComputeSelectionModel"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"

class A13WorkPortfolio extends PortfolioSingleIntraNodeSolver {
  override getCombinationDefs(): string[][] {
    return [["highDensityA13"]]
  }
}

test("learned A13 cost counts actual kernel expansions rather than batched outer steps", () => {
  const model = new ContextualComputeSelectionModel()
  const portfolio = new A13WorkPortfolio({
    nodeWithPortPoints: {
      capacityMeshNodeId: "a13-work",
      center: { x: 0, y: 0 },
      width: 4,
      height: 4,
      availableZ: [0, 1],
      portPoints: [
        { connectionName: "a", x: -2, y: 0, z: 0 },
        { connectionName: "a", x: 2, y: 0, z: 0 },
      ],
    },
    computeSelectionModel: model,
    enableNegotiatedSearch: true,
    traceWidth: 0.1,
    viaDiameter: 0.3,
    obstacleMargin: 0.1,
    layerCount: 2,
  })
  portfolio.solve()
  expect(portfolio.solved).toBe(true)
  const solver = portfolio.winningSolver
  expect(solver).toBeInstanceOf(HighDensitySolverA13)
  if (!(solver instanceof HighDensitySolverA13)) throw new Error("Expected A13")
  expect(solver.routingIterations).toBeGreaterThan(solver.iterations)
  const evidence = model.getEvidence()
  expect(evidence.observations).toHaveLength(1)
  expect(evidence.observations[0]!.strategy).toBe("A13")
  expect(evidence.observations[0]!.work).toBe(solver.routingIterations / portfolio.MIN_SUBSTEPS)
  expect(evidence.observations[0]!.outcome).toBe("valid")
  expect(evidence.stats.learnedComputePortfolioOverheadMs).toBeGreaterThanOrEqual(0)
  expect(evidence.stats.learnedComputeValidationCount).toBe(1)
})
