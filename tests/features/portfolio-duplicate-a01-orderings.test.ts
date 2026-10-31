import { expect, test } from "bun:test"
import { HighDensitySolverA01 } from "@tscircuit/high-density-a01"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"

test("adaptive A01 search retains one candidate per initial connection ordering", () => {
  const solver = new PortfolioSingleIntraNodeSolver({
    nodeWithPortPoints: {
      capacityMeshNodeId: "two-connections",
      center: { x: 0, y: 0 },
      width: 2,
      height: 2,
      availableZ: [0, 1],
      portPoints: [
        { x: -1, y: 0, z: 0, connectionName: "a" },
        { x: 1, y: 0, z: 0, connectionName: "a" },
        { x: 0, y: -1, z: 0, connectionName: "b" },
        { x: 0, y: 1, z: 0, connectionName: "b" },
      ],
    },
  })
  solver.initializeSolvers()
  const first = solver.supervisedSolvers!.find(
    ({ hyperParameters }) => hyperParameters.HIGH_DENSITY_A01,
  )!.solver
  // Expansion occurs after earlier candidates have already changed their queues.
  const firstA01 = first as unknown as HighDensitySolverA01
  firstA01.unsolvedConnections.shift()
  const adaptiveSolver = solver as unknown as { expandAdaptiveSearch(): void }
  adaptiveSolver.expandAdaptiveSearch()
  const candidates = solver.supervisedSolvers!.filter(
    ({ hyperParameters }) => hyperParameters.HIGH_DENSITY_A01,
  )
  // Seeds 0 through 5 all produce the same permutation of two segments.
  expect(candidates).toHaveLength(1)
  expect(candidates[0]!.solver).toBe(first)
  expect(solver.stats.adaptiveSearchExpanded).toBe(true)
})
