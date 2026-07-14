import { expect, test } from "bun:test"
import { HyperSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/HyperSingleIntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"

const createSolver = () =>
  new PortfolioSingleIntraNodeSolver({
    nodeWithPortPoints: {
      capacityMeshNodeId: "cn1",
      center: { x: 0, y: 0 },
      width: 1,
      height: 1,
      portPoints: [],
    },
    traceWidth: 0.15,
    viaDiameter: 0.3,
    obstacleMargin: 0.15,
    obstacles: [],
    layerCount: 2,
  })

test("external high-density child solvers expose stable solver names", () => {
  const portfolioSolver = createSolver()

  const highDensityA01Solver = portfolioSolver.generateSolver({
    HIGH_DENSITY_A01: true,
  })
  const highDensityA03Solver = portfolioSolver.generateSolver({
    HIGH_DENSITY_A03: true,
  })

  expect(highDensityA01Solver.getSolverName()).toBe("HighDensitySolverA01")
  expect(highDensityA03Solver.getSolverName()).toBe("HighDensitySolverA03")
})

test("portfolio solver has a distinct runtime name and keeps its legacy alias", () => {
  expect(HyperSingleIntraNodeSolver).toBe(PortfolioSingleIntraNodeSolver)
  expect(createSolver().getSolverName()).toBe("PortfolioSingleIntraNodeSolver")
})
