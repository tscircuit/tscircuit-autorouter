import { expect, test } from "bun:test"
import {
  HighDensitySolverA01,
  HighDensitySolverA03,
} from "@tscircuit/high-density-a01"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("portfolio budgets preserve limits and defer unused grids", () => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "lazy-grid-budget",
    center: { x: 0, y: 0 },
    width: 3.01,
    height: 2.07,
    availableZ: [0, 1, 2, 3],
    portPoints: [
      { connectionName: "a", x: -1, y: -0.6, z: 0 },
      { connectionName: "a", x: 1, y: -0.6, z: 0 },
      { connectionName: "b", x: -1, y: 0.6, z: 0 },
      { connectionName: "b", x: 1, y: 0.6, z: 1 },
    ],
  }
  const portfolio = new PortfolioSingleIntraNodeSolver({
    nodeWithPortPoints: node,
    cacheProvider: null,
    effort: 1,
  })
  portfolio.initializeSolvers()
  const grids = portfolio.supervisedSolvers!.filter(
    ({ solver }) =>
      solver instanceof HighDensitySolverA01 ||
      solver instanceof HighDensitySolverA03,
  )
  expect(grids).toHaveLength(2)
  for (const { solver } of grids) {
    const candidate = solver as unknown as
      | HighDensitySolverA01
      | HighDensitySolverA03
    const eager =
      candidate instanceof HighDensitySolverA01
        ? new HighDensitySolverA01(candidate.getConstructorParams()[0])
        : new HighDensitySolverA03(candidate.getConstructorParams()[0])
    eager.setup()
    const expectedLimit = Math.min(
      eager.MAX_ITERATIONS,
      (portfolio as any).getGridSearchIterationBudget(),
    )
    expect(candidate.MAX_ITERATIONS).toBe(expectedLimit)
    expect(candidate._setupDone).toBe(false)
    expect((candidate as any).usedCellsFlat).toBeUndefined()
    expect((candidate as any).visitedStamp).toBeUndefined()
    expect(candidate.unsolvedConnections).toEqual(eager.unsolvedConnections)
    expect(candidate.solvedConnectionsMap.size).toBe(0)
    expect(candidate.progress).toBe(eager.progress)
    expect(candidate.failed).toBe(eager.failed)
    eager.MAX_ITERATIONS = expectedLimit
    candidate.step()
    eager.step()
    expect(candidate._setupDone).toBe(true)
    expect(candidate.MAX_ITERATIONS).toBe(expectedLimit)
    expect(candidate.iterations).toBe(eager.iterations)
    expect(candidate.activeConnection).toEqual(eager.activeConnection)
    expect(candidate.openSet).toEqual(eager.openSet)
    expect((candidate as any).usedCellsFlat).toEqual((eager as any).usedCellsFlat)
    expect((candidate as any).baseSearchBudgetIters).toBe(
      (eager as any).baseSearchBudgetIters,
    )
  }
})
