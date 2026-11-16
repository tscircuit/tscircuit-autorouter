import { expect, test } from "bun:test"
import { MultiHeadPolyLineIntraNodeSolver3 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver3_ViaPossibilitiesSolverIntegration"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("polyline candidates can use the requested width in a narrow channel", (): void => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "narrow-channel",
    center: { x: 0, y: 0 },
    width: 1,
    height: 0.6,
    availableZ: [0],
    portPoints: [
      { x: -0.5, y: -0.12, z: 0, connectionName: "signal_a" },
      { x: 0.5, y: -0.12, z: 0, connectionName: "signal_a" },
      { x: -0.5, y: 0.12, z: 0, connectionName: "signal_b" },
      { x: 0.5, y: 0.12, z: 0, connectionName: "signal_b" },
    ],
  }
  const portfolio = new PortfolioSingleIntraNodeSolver({
    nodeWithPortPoints: node,
    traceWidth: 0.119,
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
  expect(solver.failed).toBeTrue()
  expect(solver.solved).toBeFalse()
})
