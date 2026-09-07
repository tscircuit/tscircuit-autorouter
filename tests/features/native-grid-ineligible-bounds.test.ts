import { expect, test } from "bun:test"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("expanded portfolio reports failed native bounds eligibility without reading uninitialized routes", () => {
  const nodeWithPortPoints: NodeWithPortPoints = {
    capacityMeshNodeId: "rounded-boundary",
    center: { x: 0, y: 0 },
    width: 2,
    height: 2,
    availableZ: [0, 1],
    portPoints: [
      { connectionName: "net", x: -1, y: 0, z: 0 },
      { connectionName: "net", x: 1 + 2e-7, y: 0, z: 0 },
    ],
  }
  const originalNode = structuredClone(nodeWithPortPoints)
  const portfolio = new PortfolioSingleIntraNodeSolver({
    nodeWithPortPoints,
    useHighDensitySolverA11: true,
  })
  portfolio.initializeSolvers()
  portfolio.adaptiveSearchExpanded = true
  const nativeCandidates = portfolio.supervisedSolvers!.filter(
    ({ hyperParameters }) =>
      hyperParameters.HIGH_DENSITY_A11,
  )
  expect(nativeCandidates).toHaveLength(1)
  for (const { solver } of nativeCandidates) {
    solver.step()
    expect(solver.failed).toBe(true)
    expect(solver.solved).toBe(false)
    expect(solver.error).toContain("outside original node bounds")
    expect(portfolio.computeH(solver)).toBe(1)
    expect(portfolio.getSupervisedSolverWithBestFitness()?.solver).not.toBe(solver)
  }
  expect(nodeWithPortPoints).toEqual(originalNode)
  expect(portfolio.solvedRoutes).toEqual([])
})
