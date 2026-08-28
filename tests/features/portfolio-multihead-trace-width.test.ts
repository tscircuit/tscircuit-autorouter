import { expect, test } from "bun:test"
import { MultiHeadPolyLineIntraNodeSolver3 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver3_ViaPossibilitiesSolverIntegration"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"

test("the portfolio multi-head candidate preserves the requested trace width", () => {
  const portfolioSolver = new PortfolioSingleIntraNodeSolver({
    nodeWithPortPoints: {
      capacityMeshNodeId: "multi-head-trace-width",
      center: { x: 0, y: 0 },
      width: 2,
      height: 2,
      availableZ: [0, 1],
      portPoints: [
        { connectionName: "route_A", x: -0.5, y: 0, z: 0 },
        { connectionName: "route_A", x: 0.5, y: 0, z: 0 },
        { connectionName: "route_B", x: 0, y: -0.5, z: 1 },
        { connectionName: "route_B", x: 0, y: 0.5, z: 1 },
      ],
    },
    traceWidth: 0.1,
    viaDiameter: 0.3,
    obstacleMargin: 0.15,
    effort: 1,
  })
  const multiHeadSolver = portfolioSolver.generateSolver({
    MULTI_HEAD_POLYLINE_SOLVER: true,
    SEGMENTS_PER_POLYLINE: 6,
    BOUNDARY_PADDING: 0.05,
  })

  expect(multiHeadSolver).toBeInstanceOf(MultiHeadPolyLineIntraNodeSolver3)
  if (!(multiHeadSolver instanceof MultiHeadPolyLineIntraNodeSolver3)) {
    throw new Error("Expected the multi-head polyline candidate")
  }
  expect(multiHeadSolver.traceWidth).toBe(0.1)
})
