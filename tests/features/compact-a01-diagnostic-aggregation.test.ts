import { expect, test } from "bun:test"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { HighDensitySolverA01Compact } from "lib/solvers/HyperHighDensitySolver/HighDensitySolverA01Compact"

test("compact metrics accumulate once per scheduled batch and survive candidate retirement", () => {
  const diagnostics: Record<string, number> = {}
  const portfolio = new PortfolioSingleIntraNodeSolver({
    nodeWithPortPoints: {
      capacityMeshNodeId: "metrics", center: { x: 0, y: 0 }, width: 2, height: 2, availableZ: [0, 1],
      portPoints: [
        { x: -1, y: 0, z: 0, connectionName: "a" },
        { x: 1, y: 0, z: 1, connectionName: "a" },
      ],
    },
    viaDiameter: 0.3, traceWidth: 0.15, obstacleMargin: 0.15,
    obstacles: [], layerCount: 2, priorityDiagnostics: diagnostics,
  })
  const candidate = portfolio.generateSolver({ HIGH_DENSITY_A01: true })
  expect(candidate).toBeInstanceOf(HighDensitySolverA01Compact)
  candidate.solve()
  portfolio.computeG(candidate)
  const snapshot = { ...diagnostics }
  portfolio.computeG(candidate)
  expect(diagnostics).toEqual(snapshot)
  expect(diagnostics.compactA01Candidates).toBe(1)
  expect(diagnostics.compactA01Enqueued).toBeGreaterThan(0)
  expect(diagnostics.compactA01MaterializedPathLabels).toBeGreaterThan(0)
  const second = portfolio.generateSolver({ HIGH_DENSITY_A01: true })
  second.solve()
  portfolio.computeG(second)
  expect(diagnostics.compactA01Candidates).toBe(2)
  expect(diagnostics.compactA01Enqueued).toBe(snapshot.compactA01Enqueued! * 2)
  expect(diagnostics.compactA01PeakLabels).toBe(snapshot.compactA01PeakLabels!)
})
