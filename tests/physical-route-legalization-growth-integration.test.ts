import { expect, test } from "bun:test"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type {
  HighDensityIntraNodeRoute,
  NodeWithPortPoints,
} from "lib/types/high-density-types"

test("grown topology legalization runs after inverse scaling and reports through shared diagnostic counters", () => {
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "test",
    center: { x: 0, y: 0 },
    width: 3,
    height: 3,
    portPoints: [],
  }
  const diagnostics: Record<string, number> = {}
  const solver = new GrowShrinkHighDensityIntraNodeSolver({
    nodeWithPortPoints: node,
    physicalLegalization: true,
    layerCount: 2,
    obstacleMargin: 0.1,
    priorityDiagnostics: diagnostics,
    fallbackToInvalidGeometryOnFailure: false,
  })
  const proposal: HighDensityIntraNodeRoute[] = [
    {
      connectionName: "via-net",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -2, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 },
        { x: 2, y: 0, z: 1 },
      ],
      vias: [{ x: 0, y: 0 }],
    },
    {
      connectionName: "wire-net",
      traceThickness: 0.1,
      viaDiameter: 0.3,
      route: [
        { x: -2, y: 0.44, z: 0 },
        { x: 2, y: 0.44, z: 0 },
      ],
      vias: [],
    },
  ]
  const portfolio = new PortfolioSingleIntraNodeSolver({ nodeWithPortPoints: node })
  // Supply a completed relaxed candidate at the public child-solver boundary.
  portfolio.solvedRoutes = proposal
  portfolio.solved = true
  solver.activeSubSolver = portfolio
  solver.scaleFactor = 2
  solver.growthAttempts = 1
  solver.step()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.solvedRoutes[0]!.route[0]).toEqual({ x: -1, y: 0, z: 0 })
  expect(solver.solvedRoutes[0]!.vias[0]!.y).toBeLessThan(-0.079)
  expect(diagnostics.physicalLegalizationProposalCount).toBe(1)
  expect(diagnostics.physicalLegalizationCopperPairsBefore).toBe(1)
  expect(diagnostics.physicalLegalizationCopperPairsAfter).toBe(0)
  expect(diagnostics.physicalLegalizationTimeMs).toBeGreaterThan(0)
})
