import { expect, test } from "bun:test"
import { PathPackingIntraNodeSolver } from "lib/solvers/HighDensitySolver/PathPackingIntraNodeSolver"
import { createPathPackingAudit } from "lib/solvers/HighDensitySolver/pathPackingGeometry"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { packingCrossingNode } from "./fixtures/pathPackingSynthetic"

test("selected-proposal evidence increments only when the actual portfolio accepts its completed packing winner", () => {
  class PackingOnlyPortfolio extends PortfolioSingleIntraNodeSolver {
    override getCombinationDefs(): string[][] { return [["pathPacking"]] }
  }
  const audit = createPathPackingAudit()
  const diagnostics = { pathPackingPortfolioSelectedNodes: 0 }
  const portfolio = new PackingOnlyPortfolio({ nodeWithPortPoints: structuredClone(packingCrossingNode),
    traceWidth: 0.1, viaDiameter: 0.3, viaHoleDiameter: 0.15, obstacleMargin: 0.1, layerCount: 2,
    obstacles: [], experimentPathPacking: true, pathPackingStats: audit, priorityDiagnostics: diagnostics })
  while (!portfolio.solved && !portfolio.failed) {
    expect(diagnostics.pathPackingPortfolioSelectedNodes).toBe(0)
    portfolio.step()
  }
  expect(portfolio.solved).toBeTrue()
  expect(portfolio.failed).toBeFalse()
  expect(portfolio.winningSolver).toBeInstanceOf(PathPackingIntraNodeSolver)
  expect(audit.solvedNodes).toBe(1)
  expect(diagnostics.pathPackingPortfolioSelectedNodes).toBe(1)
  expect(portfolio.solvedRoutes).toHaveLength(2)
  portfolio.step()
  expect(diagnostics.pathPackingPortfolioSelectedNodes).toBe(1)
  expect(Object.keys(audit)).toHaveLength(16)
})
