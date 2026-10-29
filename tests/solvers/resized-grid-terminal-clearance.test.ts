import { expect, test } from "bun:test"
import { HighDensitySolverA03 } from "@tscircuit/high-density-a01"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"

test("incompatible fixed terminals fail before a resized grid is allocated", (): void => {
  const solver = new PortfolioSingleIntraNodeSolver({
    nodeWithPortPoints: {
      capacityMeshNodeId: "crowded-resized-node",
      center: { x: 0, y: 0 },
      width: 200,
      height: 200,
      availableZ: [0, 1],
      portPoints: [
        { x: -100, y: 0, z: 0, connectionName: "a" },
        { x: 100, y: 0, z: 0, connectionName: "a" },
        { x: -100, y: 0.2, z: 0, connectionName: "b" },
        { x: 100, y: 10, z: 0, connectionName: "b" },
      ],
    },
    useMultiResolutionGrid: true,
    traceWidth: 0.127,
    viaDiameter: 0.3,
    effort: 1,
  })
  solver.initializeSolvers()
  const gridCandidates = solver.supervisedSolvers!.filter(
    (candidate) => candidate.solver instanceof HighDensitySolverA03,
  )
  expect(gridCandidates).toHaveLength(2)
  for (const { solver: candidate } of gridCandidates) {
    expect(candidate).toBeInstanceOf(HighDensitySolverA03)
    if (!(candidate instanceof HighDensitySolverA03)) {
      throw new Error("Expected the portfolio's native multiresolution candidate")
    }
    expect(candidate.solved).toBeFalse()
    expect(candidate.failed).toBeTrue()
    expect(candidate.error).toContain("terminals violate")
    candidate.step()
    expect(candidate.gridStats.states).toBe(0)
    expect(candidate.solvedConnectionsMap.size).toBe(0)
  }
  expect(solver.solved).toBeFalse()
  expect(solver.failed).toBeFalse()
})
