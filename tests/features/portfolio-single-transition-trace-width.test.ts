import { expect, test } from "bun:test"
import { SingleTransitionIntraNodeSolver } from "lib/solvers/HighDensitySolver/SingleTransitionIntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"

test("the portfolio single-transition candidate preserves the requested trace width", () => {
  const portfolioSolver = new PortfolioSingleIntraNodeSolver({
    nodeWithPortPoints: {
      capacityMeshNodeId: "single-transition-trace-width",
      center: { x: 0, y: 0 },
      width: 2,
      height: 2,
      availableZ: [0, 1],
      portPoints: [
        { connectionName: "route_A", x: -0.5, y: 0, z: 0 },
        { connectionName: "route_A", x: 0.5, y: 0, z: 1 },
      ],
    },
    traceWidth: 0.1,
    viaDiameter: 0.3,
    obstacleMargin: 0.15,
    effort: 1,
  })
  const transitionSolver = portfolioSolver.generateSolver({
    CLOSED_FORM_SINGLE_TRANSITION: true,
  })

  expect(transitionSolver).toBeInstanceOf(SingleTransitionIntraNodeSolver)
  if (!(transitionSolver instanceof SingleTransitionIntraNodeSolver)) {
    throw new Error("Expected the closed-form single-transition candidate")
  }
  expect(transitionSolver.solved).toBe(true)
  expect(transitionSolver.solvedRoutes).toHaveLength(1)
  expect(transitionSolver.solvedRoutes[0]!.traceThickness).toBe(0.1)
})
