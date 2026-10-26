import { expect, test } from "bun:test"
import { HighDensitySolverA13 } from "@tscircuit/high-density-a13"
import { HighDensitySolverA13WithDrcValidation } from "lib/solvers/HyperHighDensitySolver/HighDensitySolverA13WithDrcValidation"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("the consistent-priority A13 factory retains its budgets and board-copper rejection", (): void => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "consistent-priority-pad-crossing",
    center: { x: 0, y: 0 },
    width: 4,
    height: 4,
    availableZ: [0],
    portPoints: [
      { connectionName: "signal", x: -2, y: 0, z: 0 },
      { connectionName: "signal", x: 2, y: 0, z: 0 },
    ],
  }
  const params = {
    nodeWithPortPoints: node,
    traceWidth: 0.1,
    viaDiameter: 0.3,
    obstacleMargin: 0.1,
    layerCount: 2,
    effort: 0.25,
    obstacles: [
      {
        type: "rect" as const,
        center: { x: 0, y: 0 },
        width: 0.5,
        height: 0.5,
        layers: ["top"],
        connectedTo: ["pcb_port_other"],
        circuitJsonMetadata: {
          pcb_smtpad_id: "pcb_smtpad_other",
          pcb_port_id: "pcb_port_other",
        },
      },
    ],
  }
  const portfolio = new PortfolioSingleIntraNodeSolver(params)
  const candidate = portfolio.generateSolver({
    HIGH_DENSITY_A13: true,
    SHUFFLE_SEED: 3,
  })
  if (!(candidate instanceof HighDensitySolverA13WithDrcValidation)) {
    throw new Error("Expected the existing validated A13 candidate")
  }
  expect(candidate.hyperParameters).toEqual({
    shuffleSeed: 3,
    greedyMultiplier: 1,
  })
  expect(candidate.props.maxSearchIterations).toBe(12_500_000)
  expect(candidate.props.maxRounds).toBe(50)
  expect(candidate.props.stepMultiplier).toBe(1000)
  expect(candidate.MAX_ITERATIONS).toBe(25_000_000)
  expect(candidate.traceMargin).toBe(0.1)
  candidate.solve()
  expect(candidate.solved).toBe(false)
  expect(candidate.failed).toBe(true)
  expect(candidate.stats.boardDrcIssueCount).toBeGreaterThan(0)
  expect(candidate.error).toContain("board copper validation")

  const connectedPortfolio = new PortfolioSingleIntraNodeSolver({
    ...params,
    obstacles: params.obstacles.map((obstacle) => ({
      ...obstacle,
      connectedTo: [...obstacle.connectedTo, "signal"],
    })),
  })
  const connectedCandidate = connectedPortfolio.generateSolver({
    HIGH_DENSITY_A13: true,
  })
  if (!(connectedCandidate instanceof HighDensitySolverA13WithDrcValidation)) {
    throw new Error("Expected the existing validated A13 candidate")
  }
  connectedCandidate.solve()
  expect(connectedCandidate.solved).toBe(true)
  expect(connectedCandidate.failed).toBe(false)
  expect(connectedCandidate.stats.boardDrcIssueCount).toBe(0)
  expect(
    new HighDensitySolverA13({ nodeWithPortPoints: node }).hyperParameters,
  ).toEqual({ shuffleSeed: 0, greedyMultiplier: 1.1 })
})
