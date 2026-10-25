import { expect, test } from "bun:test"
import { HighDensitySolverA13EventTiles } from "lib/solvers/HyperHighDensitySolver/HighDensitySolverA13EventTiles"
import { HighDensitySolverA13WithDrcValidation } from "lib/solvers/HyperHighDensitySolver/HighDensitySolverA13WithDrcValidation"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { getEventTileSearchPolicy } from "lib/solvers/HyperHighDensitySolver/eventTileSearchPolicy"
import type { NodeWithPortPoints } from "lib/types/high-density-types"

test("preprocessing and interaction policy retains the original A13 candidate for large captured node shapes", (): void => {
  const shapes = [
    { width: 11.475, height: 9.265, layers: 2, ports: 30, expected: true },
    { width: 12.7425, height: 10.6166666667, layers: 2, ports: 52, expected: false },
    { width: 11.8385, height: 14.581, layers: 6, ports: 16, expected: false },
    { width: 2, height: 2, layers: 2, ports: 34, expected: false },
  ]
  for (const shape of shapes) {
    const node: NodeWithPortPoints = {
      capacityMeshNodeId: "event-trial-policy",
      center: { x: 0, y: 0 }, width: shape.width, height: shape.height,
      availableZ: Array.from({ length: shape.layers }, (_, layer): number => layer),
      portPoints: Array.from({ length: shape.ports }, (_, index) => ({
        x: (index % 2 ? 1 : -1) * shape.width / 2,
        y: index / shape.ports - 0.5, z: 0,
        connectionName: `signal-${Math.floor(index / 2)}`,
      })),
    }
    const policy = getEventTileSearchPolicy({ nodeWithPortPoints: node,
      cellSizeMm: 0.1, traceThickness: 0.1, traceMargin: 0.1,
      maxSearchIterations: 50_000_000 })
    expect(policy.eligible).toBe(shape.expected)
    if (policy.eligible) expect(policy.preprocessingReserve).toBeLessThanOrEqual(50_000)
    const portfolio = new PortfolioSingleIntraNodeSolver({
      nodeWithPortPoints: node, eventSearch: true, traceWidth: 0.1,
      enableNegotiatedSearch: true, layerCount: shape.layers,
    })
    const solver = portfolio.generateSolver({ HIGH_DENSITY_A13: true })
    expect(solver).toBeInstanceOf(shape.expected ? HighDensitySolverA13EventTiles : HighDensitySolverA13WithDrcValidation)
    expect(solver instanceof HighDensitySolverA13EventTiles).toBe(shape.expected)
    expect(getEventTileSearchPolicy({ nodeWithPortPoints: node,
      cellSizeMm: 0.1, traceThickness: 0.1, traceMargin: 0.1,
      maxSearchIterations: 1 }).eligible).toBe(false)
  }
})
