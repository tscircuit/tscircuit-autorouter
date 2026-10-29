import { HighDensitySolverA01 } from "@tscircuit/high-density-a01"
import { expect, test } from "bun:test"
import { HighDensitySolverA01Compact } from "lib/solvers/HyperHighDensitySolver/HighDensitySolverA01Compact"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("normal portfolio uses storage-only on every supported scene while keeping explicit pruning available", () => {
  const diagnostics: Record<string, number> = {}
  for (const [width, height, owners, expected] of [
    [1, 1, 12, "storage"],
    [51.2, 51.2, 12, "storage"],
    [102.4, 51.2, 12, "storage"],
    [102.4, 51.2, 33, "original"],
  ] as const) {
    const node: NodeWithPortPoints = {
      capacityMeshNodeId: "factory-policy", center: { x: 0, y: 0 }, width, height,
      availableZ: [0, 1, 2, 3, 4, 5, 6, 7],
      portPoints: Array.from({ length: owners }, (_, owner) => [
        { connectionName: `net${owner}`, x: -width / 2, y: owner / 100, z: 0 },
        { connectionName: `net${owner}`, x: width / 2, y: owner / 100, z: 7 },
      ]).flat(),
    }
    const portfolio = new PortfolioSingleIntraNodeSolver({
      nodeWithPortPoints: node, layerCount: 8, obstacles: [],
      traceWidth: 0.1, viaDiameter: 0.3, priorityDiagnostics: diagnostics,
    })
    const solver = portfolio.generateSolver({ HIGH_DENSITY_A01: true })
    expect(solver).toBeInstanceOf(HighDensitySolverA01)
    if (expected === "original") expect(solver).not.toBeInstanceOf(HighDensitySolverA01Compact)
    else {
      expect(solver).toBeInstanceOf(HighDensitySolverA01Compact)
      const compact = solver as unknown as HighDensitySolverA01Compact
      expect(compact.compactFrontierPruning).toBe(false)
      const explicitPruning = new HighDensitySolverA01Compact({
        ...compact.getConstructorParams()[0], compactFrontierPruning: true,
      })
      expect(explicitPruning.compactFrontierPruning).toBe(true)
    }
  }
  expect(diagnostics.compactA01Candidates).toBe(3)
  expect(diagnostics.compactA01UnsupportedCandidates).toBe(1)
  expect(diagnostics.compactA01StorageOnlyCandidates).toBe(3)
})
