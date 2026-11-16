import { expect, test } from "bun:test"
import { MultiHeadPolyLineIntraNodeSolver3 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver3_ViaPossibilitiesSolverIntegration"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("polyline candidates enforce the requested terminal clearance", (): void => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "narrow-channel",
    center: { x: 0, y: 0 },
    width: 1,
    height: 0.6,
    availableZ: [0],
    portPoints: [
      { x: -0.5, y: -0.13, z: 0, connectionName: "signal_a" },
      { x: 0.5, y: -0.13, z: 0, connectionName: "signal_a" },
      { x: -0.5, y: 0.13, z: 0, connectionName: "signal_b" },
      { x: 0.5, y: 0.13, z: 0, connectionName: "signal_b" },
    ],
  }
  const portfolio = new PortfolioSingleIntraNodeSolver({
    nodeWithPortPoints: node,
    traceWidth: 0.15,
    obstacleMargin: 0.119,
    viaDiameter: 0.4,
  })
  const solver = portfolio.generateSolver({
    MULTI_HEAD_POLYLINE_SOLVER: true,
    SEGMENTS_PER_POLYLINE: 3,
  })
  if (!(solver instanceof MultiHeadPolyLineIntraNodeSolver3)) {
    throw new Error("Expected the polyline portfolio candidate")
  }
  solver.solve()
  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
  expect(solver.solvedRoutes).toHaveLength(2)
  const terminalClearance =
    Math.abs(node.portPoints[2]!.y - node.portPoints[0]!.y) -
    solver.solvedRoutes[0]!.traceThickness
  expect(terminalClearance).toBeLessThan(
    portfolio.constructorParams.obstacleMargin!,
  )
})
