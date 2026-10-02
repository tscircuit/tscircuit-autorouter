import { expect, test } from "bun:test"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"

const createPortfolio = (
  availableZ: number[],
  layerCount: number,
  allowSearchExpansion = true,
) =>
  new PortfolioSingleIntraNodeSolver({
    nodeWithPortPoints: {
      capacityMeshNodeId: `node-${availableZ.length}-layer`,
      center: { x: 0, y: 0 },
      width: 10,
      height: 10,
      availableZ,
      portPoints: [
        { x: -5, y: -1, z: 0, connectionName: "route-a" },
        { x: 5, y: -1, z: 0, connectionName: "route-a" },
        { x: -5, y: 1, z: 0, connectionName: "route-b" },
        { x: 5, y: 1, z: 0, connectionName: "route-b" },
      ],
    },
    traceWidth: 0.15,
    viaDiameter: 0.3,
    obstacleMargin: 0.15,
    obstacles: [],
    layerCount,
    allowSearchExpansion,
  })

test("six-layer nodes defer parameter sweeps until solver families are exhausted", () => {
  const fourLayerPortfolio = createPortfolio([0, 1, 2, 3], 4)
  const growableSixLayerPortfolio = createPortfolio([0], 6, false)
  const finalSixLayerPortfolio = createPortfolio([0], 6)

  fourLayerPortfolio.initializeSolvers()
  growableSixLayerPortfolio.initializeSolvers()
  finalSixLayerPortfolio.initializeSolvers()

  expect(fourLayerPortfolio.fullPortfolioInitialized).toBeTrue()
  expect(fourLayerPortfolio.supervisedSolvers).toHaveLength(70)
  expect(growableSixLayerPortfolio.fullPortfolioInitialized).toBeFalse()
  expect(growableSixLayerPortfolio.supervisedSolvers).toHaveLength(10)

  for (const candidate of growableSixLayerPortfolio.supervisedSolvers ?? []) {
    candidate.solver.failed = true
  }
  growableSixLayerPortfolio.step()
  expect(growableSixLayerPortfolio.failed).toBeTrue()
  expect(growableSixLayerPortfolio.fullPortfolioInitialized).toBeFalse()

  for (const candidate of finalSixLayerPortfolio.supervisedSolvers ?? []) {
    candidate.solver.failed = true
  }
  finalSixLayerPortfolio.step()
  expect(finalSixLayerPortfolio.failed).toBeFalse()
  expect(finalSixLayerPortfolio.fullPortfolioInitialized).toBeTrue()
  expect(finalSixLayerPortfolio.supervisedSolvers).toHaveLength(70)
})

test("six-layer two-terminal nodes try applicable solvers before the full portfolio", () => {
  const portfolio = new PortfolioSingleIntraNodeSolver({
    nodeWithPortPoints: {
      capacityMeshNodeId: "single-route-six-layer-node",
      center: { x: 0, y: 0 },
      width: 10,
      height: 10,
      availableZ: [0, 1, 2, 3, 4, 5],
      portPoints: [
        { x: -5, y: 0, z: 0, connectionName: "route" },
        { x: 5, y: 0, z: 0, connectionName: "route" },
      ],
    },
    traceWidth: 0.15,
    viaDiameter: 0.3,
    obstacleMargin: 0.15,
    obstacles: [],
    layerCount: 6,
    allowSearchExpansion: true,
  })

  portfolio.initializeSolvers()

  expect(portfolio.supervisedSolvers).toHaveLength(4)
  for (const candidate of portfolio.supervisedSolvers ?? []) {
    candidate.solver.failed = true
  }
  portfolio.step()
  expect(portfolio.failed).toBeFalse()
  expect(portfolio.fullPortfolioInitialized).toBeTrue()
  expect(portfolio.supervisedSolvers).toHaveLength(70)

  const branchedRoutePortfolio = new PortfolioSingleIntraNodeSolver({
    nodeWithPortPoints: {
      capacityMeshNodeId: "branched-route-six-layer-node",
      center: { x: 0, y: 0 },
      width: 10,
      height: 10,
      availableZ: [0, 1, 2, 3, 4, 5],
      portPoints: [
        { x: -5, y: -1, z: 0, connectionName: "route" },
        { x: 5, y: -1, z: 0, connectionName: "route" },
        { x: -5, y: 1, z: 0, connectionName: "route" },
        { x: 5, y: 1, z: 0, connectionName: "route" },
      ],
    },
    traceWidth: 0.15,
    viaDiameter: 0.3,
    obstacleMargin: 0.15,
    obstacles: [],
    layerCount: 6,
    allowSearchExpansion: true,
  })

  branchedRoutePortfolio.initializeSolvers()
  expect(branchedRoutePortfolio.supervisedSolvers).toHaveLength(10)
})
