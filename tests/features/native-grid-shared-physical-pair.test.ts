import { expect, test } from "bun:test"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { doRoutesCoverNodePortPointPairsExactlyOnce } from "lib/solvers/HyperHighDensitySolver/repairDisconnectedSameRootPortPoints"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("native grids retain unique same-root pairs without changing legacy alias repair", () => {
  const nodeWithPortPoints: NodeWithPortPoints = {
    capacityMeshNodeId: "node",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    portPoints: ["branch-a", "branch-b"].flatMap((connectionName) =>
      [-1, 1].map((x) => ({
        connectionName,
        rootConnectionName: "root",
        x,
        y: 0,
        z: 0,
      })),
    ),
  }
  for (const { hyperParameters, expectedRouteCount } of [
    { hyperParameters: { HIGH_DENSITY_A11: true }, expectedRouteCount: 1 },
    { hyperParameters: { HIGH_DENSITY_A01: true }, expectedRouteCount: 2 },
    { hyperParameters: { HIGH_DENSITY_A03: true }, expectedRouteCount: 2 },
  ]) {
    const portfolio = new PortfolioSingleIntraNodeSolver({ nodeWithPortPoints })
    const solver = portfolio.generateSolver(hyperParameters)
    solver.solve()
    expect(solver.solved).toBe(true)

    portfolio.onSolve({ solver, hyperParameters, h: 0, g: 0, f: 0 })
    expect(portfolio.solvedRoutes).toHaveLength(expectedRouteCount)
    expect(
      doRoutesCoverNodePortPointPairsExactlyOnce(
        portfolio.solvedRoutes,
        nodeWithPortPoints,
      ),
    ).toBe(expectedRouteCount === 1)
  }
})
