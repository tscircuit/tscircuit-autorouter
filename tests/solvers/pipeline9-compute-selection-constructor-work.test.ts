import { expect, test } from "bun:test"
import { ContextualComputeSelectionModel } from "lib/solvers/HyperHighDensitySolver/ContextualComputeSelectionModel"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"

class ConstructorWorkPortfolio extends PortfolioSingleIntraNodeSolver {
  override getCombinationDefs(): string[][] {
    return [["throughObstacle"]]
  }
}

test("a legal copper-bridge constructor records a validated outcome with nonzero acceptance work", () => {
  const model = new ContextualComputeSelectionModel()
  const portfolio = new ConstructorWorkPortfolio({
    nodeWithPortPoints: {
      capacityMeshNodeId: "bridge-work",
      center: { x: 0, y: 0 },
      width: 4,
      height: 4,
      availableZ: [0, 1],
      portPoints: [
        { connectionName: "a", x: -0.2, y: 0, z: 0 },
        { connectionName: "a", x: 0.2, y: 0, z: 1 },
      ],
    },
    computeSelectionModel: model,
    traceWidth: 0.1,
    viaDiameter: 0.3,
    obstacleMargin: 0.1,
    layerCount: 2,
    obstacles: [{
      type: "rect",
      center: { x: 0, y: 0 },
      width: 1,
      height: 1,
      layers: ["top", "bottom"],
      connectedTo: ["a"],
    }],
  })
  portfolio.solve()
  expect(portfolio.solved).toBe(true)
  expect(portfolio.winningSolver!.iterations).toBe(0)
  const evidence = model.getEvidence()
  expect(evidence.observations).toHaveLength(1)
  expect(evidence.observations[0]!.outcome).toBe("valid")
  expect(evidence.observations[0]!.work).toBe(1 / portfolio.MIN_SUBSTEPS)
  expect(evidence.stats.learnedComputeValidOutcomeCount).toBe(1)
  expect(evidence.stats.learnedComputeValidationCount).toBe(1)
})
