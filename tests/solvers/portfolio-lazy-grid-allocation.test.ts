import { expect, test } from "bun:test"
import { HighDensitySolverA03 } from "@tscircuit/high-density-a01"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"

class GridOnlyPortfolio extends PortfolioSingleIntraNodeSolver {
  override getCombinationDefs(): string[][] {
    return [
      ["highDensityA01"],
      ["highDensityA03"],
    ]
  }
}

test("the portfolio allocates only the multiresolution candidate it advances", (): void => {
  const solver = new GridOnlyPortfolio({
    useMultiResolutionGrid: true,
    traceWidth: 0.127,
    viaDiameter: 0.6,
    nodeWithPortPoints: {
      capacityMeshNodeId: "lazy-portfolio",
      center: { x: 10, y: 20 },
      width: 32,
      height: 16,
      availableZ: [0, 1],
      portPoints: [
        { x: -6, y: 18, z: 0, connectionName: "a" },
        { x: 26, y: 22, z: 1, connectionName: "a" },
        { x: -6, y: 22, z: 0, connectionName: "b" },
        { x: 26, y: 18, z: 1, connectionName: "b" },
      ],
    },
  })
  solver.initializeSolvers()
  expect(solver.supervisedSolvers).toHaveLength(2)
  for (const { solver: candidate } of solver.supervisedSolvers!) {
    expect(candidate).toBeInstanceOf(HighDensitySolverA03)
    if (!(candidate instanceof HighDensitySolverA03)) {
      throw new Error("Expected a native multiresolution candidate")
    }
    expect(candidate.gridStats.states).toBe(0)
    expect(candidate.MAX_ITERATIONS).toBe(candidate.maxIterations!)
    expect(candidate.solvedConnectionsMap.size).toBe(0)
    expect(candidate.visualize().points).toHaveLength(4)
    expect(candidate.gridStats.states).toBe(0)
  }

  solver.step()
  expect(solver.failed).toBeFalse()
  const selected = solver.supervisedSolvers![0]!.solver
  const untouched = solver.supervisedSolvers![1]!.solver
  if (
    !(selected instanceof HighDensitySolverA03) ||
    !(untouched instanceof HighDensitySolverA03)
  ) {
    throw new Error("Expected the initialized grid candidates")
  }
  expect(selected.gridStats.states).toBeGreaterThan(0)
  expect(selected.MAX_ITERATIONS).toBeLessThanOrEqual(selected.maxIterations!)
  expect(untouched.gridStats.states).toBe(0)
  expect(untouched.iterations).toBe(0)
})
