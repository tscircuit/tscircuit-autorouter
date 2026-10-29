import { expect, test } from "bun:test"
import { PathPackingIntraNodeSolver } from "lib/solvers/HighDensitySolver/PathPackingIntraNodeSolver"
import { createPathPackingAudit } from "lib/solvers/HighDensitySolver/pathPackingGeometry"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { packingCrossingNode } from "./fixtures/pathPackingSynthetic"

test("BaseSolver steps retain validated-bank progress and actual portfolio fitness sees it before any copper is published", () => {
  const audit = createPathPackingAudit()
  const params = { nodeWithPortPoints: structuredClone(packingCrossingNode), traceWidth: 0.1,
    viaDiameter: 0.3, viaHoleDiameter: 0.15, obstacleMargin: 0.1, layerCount: 2,
    obstacles: [], pathPackingStats: audit, experimentPathPacking: true }
  const solver = new PathPackingIntraNodeSolver(params)
  const portfolio = new PortfolioSingleIntraNodeSolver(params)
  expect(solver.progress).toBe(0)
  while (!solver.solved && !solver.failed && audit.bankTasks < 2) solver.step()
  expect(audit.bankTasks).toBe(2)
  expect(audit.distinctCandidates).toBe(8)
  expect(solver.solvedRoutes).toHaveLength(0)
  expect(solver.solved).toBeFalse()
  expect(solver.progress).toBe(0.425)
  expect(solver.computeProgress()).toBe(0.425)
  expect(portfolio.computeH(solver)).toBe(0.575)
  const actualCost = portfolio.computeG(solver)
  expect(portfolio.computeF(actualCost, portfolio.computeH(solver)))
    .toBeLessThan(portfolio.computeF(actualCost, 1))
  solver.step()
  expect(solver.progress).toBe(0.425)
  expect(solver.solvedRoutes).toHaveLength(0)
  while (!solver.solved && !solver.failed) {
    solver.step()
    if (!solver.solved) {
      expect(solver.progress).toBeLessThan(1)
      expect(solver.solvedRoutes).toHaveLength(0)
    }
  }
  expect(solver.solved).toBeTrue()
  expect(solver.progress).toBe(1)
  expect(solver.solvedRoutes).toHaveLength(2)
  expect(audit.solvedNodes).toBe(1)
  expect(solver.MAX_ITERATIONS).toBe(96_000)
})
