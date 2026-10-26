import { expect, test } from "bun:test"
import { MultiHeadPolyLineIntraNodeSolver3 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver3_ViaPossibilitiesSolverIntegration"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("MultiHead receives and emits the routing stage's requested trace width", () => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "multi-head-stage-width",
    center: { x: 0, y: 0 },
    width: 4,
    height: 4,
    availableZ: [0, 1],
    portPoints: [-0.6, 0.6].flatMap((y, index) => [
      { x: -1.5, y, z: 0, connectionName: `foreign-${index}` },
      { x: 1.5, y, z: 0, connectionName: `foreign-${index}` },
    ]),
  }
  for (const traceWidth of [0.095, 0.1, 0.2]) {
    const portfolio = new PortfolioSingleIntraNodeSolver({
      nodeWithPortPoints: node,
      traceWidth,
      viaDiameter: 0.3,
    })
    const solver = portfolio.generateSolver({
      MULTI_HEAD_POLYLINE_SOLVER: true,
      SEGMENTS_PER_POLYLINE: 6,
    }) as unknown as MultiHeadPolyLineIntraNodeSolver3
    expect(solver).toBeInstanceOf(MultiHeadPolyLineIntraNodeSolver3)
    expect(solver.traceWidth).toBe(traceWidth)
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.solvedRoutes).toHaveLength(2)
    expect(solver.solvedRoutes.map((route) => route.traceThickness)).toEqual([
      traceWidth,
      traceWidth,
    ])
    expect(solver.solvedRoutes.every((route) => route.vias.length === 0)).toBe(
      true,
    )
  }
  const legacy = new MultiHeadPolyLineIntraNodeSolver3({
    nodeWithPortPoints: node,
  })
  legacy.solve()
  expect(legacy.traceWidth).toBe(0.15)
  expect(legacy.solvedRoutes.map((route) => route.traceThickness)).toEqual([
    0.15, 0.15,
  ])
})
