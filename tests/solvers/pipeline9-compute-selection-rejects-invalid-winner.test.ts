import { expect, test } from "bun:test"
import { ContextualComputeSelectionModel } from "lib/solvers/HyperHighDensitySolver/ContextualComputeSelectionModel"
import { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import type { HighDensityRoute, NodeWithPortPoints } from "lib/types/high-density-types"

test("a fast invalid kernel result is rejected before it can become routed copper or a successful learning label", () => {
  const node: NodeWithPortPoints = { capacityMeshNodeId: "accepted-output", center: { x: 0, y: 0 }, width: 4, height: 4, availableZ: [0, 1], portPoints: [{ connectionName: "signal", x: -1, y: 0, z: 0 }, { connectionName: "signal", x: 1, y: 0, z: 0 }] }
  const options = { nodeWithPortPoints: node, traceWidth: 0.1, viaDiameter: 0.3, obstacleMargin: 0.15, layerCount: 2 }
  const route: HighDensityRoute = { connectionName: "signal", traceThickness: 0.1, viaDiameter: 0.3, route: [{ x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }], vias: [] }
  const bad = new IntraNodeRouteSolver(options)
  bad.solvedRoutes = [{ ...route, route: [{ x: -1, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }] }]
  bad.solved = true
  const good = new IntraNodeRouteSolver(options)
  good.solvedRoutes = [route]
  good.solved = true
  const model = new ContextualComputeSelectionModel()
  const portfolio = new PortfolioSingleIntraNodeSolver({ ...options, computeSelectionModel: model })
  portfolio.initializeSolvers = (): void => {
    portfolio.supervisedSolvers = [bad, good].map((solver) => ({ solver, hyperParameters: {}, g: 0, h: 0, f: 0 }))
  }
  portfolio.solve()
  expect(portfolio.solved).toBe(true)
  expect(portfolio.failed).toBe(false)
  expect(portfolio.winningSolver).toBe(good)
  expect(bad.failed).toBe(true)
  expect(bad.solved).toBe(false)
  expect(bad.error).toContain("connectivity or physical copper constraints")
  expect(portfolio.solvedRoutes[0]!.route.at(-1)).toEqual({ x: 1, y: 0, z: 0 })
  expect(model.getStats().learnedComputeInvalidOutcomeCount).toBe(1)
  expect(model.getStats().learnedComputeValidOutcomeCount).toBe(1)
  expect(model.getStats().learnedComputeValidationCount).toBe(2)
})
