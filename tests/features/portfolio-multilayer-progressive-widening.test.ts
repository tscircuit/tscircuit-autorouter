import { expect, test } from "bun:test"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"

const createPortfolio = (availableZ: number[]) =>
  new PortfolioSingleIntraNodeSolver({
    nodeWithPortPoints: {
      capacityMeshNodeId: `node-${availableZ.length}-layer`,
      center: { x: 0, y: 0 },
      width: 10,
      height: 10,
      availableZ,
      portPoints: [],
    },
    traceWidth: 0.15,
    viaDiameter: 0.3,
    obstacleMargin: 0.15,
    obstacles: [],
    layerCount: availableZ.length,
  })

test("six-layer nodes defer parameter sweeps until solver families are exhausted", () => {
  const fourLayerPortfolio = createPortfolio([0, 1, 2, 3])
  const sixLayerPortfolio = createPortfolio([0, 1, 2, 3, 4, 5])

  fourLayerPortfolio.initializeSolvers()
  sixLayerPortfolio.initializeSolvers()

  expect(fourLayerPortfolio.fullPortfolioInitialized).toBeTrue()
  expect(fourLayerPortfolio.supervisedSolvers).toHaveLength(70)
  expect(sixLayerPortfolio.fullPortfolioInitialized).toBeFalse()
  expect(sixLayerPortfolio.supervisedSolvers).toHaveLength(10)
})
