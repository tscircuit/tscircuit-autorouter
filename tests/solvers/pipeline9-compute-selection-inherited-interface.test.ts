import { expect, test } from "bun:test"
import { ContextualComputeSelectionModel } from "../../lib/solvers/HyperHighDensitySolver/ContextualComputeSelectionModel"
import { PortfolioSingleIntraNodeSolver } from "../../lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { validateComputeSelectionOutcome } from "../../lib/solvers/HyperHighDensitySolver/validateComputeSelectionOutcome"
import type { NodeWithPortPoints } from "../../lib/types/high-density-types"

test("a native local winner with inherited immutable-interface clearance debt stays provisional and supplies no clean survival event", (): void => {
  const node: NodeWithPortPoints = { capacityMeshNodeId: "inherited-interface", center: { x: 0, y: 0 }, width: 5, height: 5, availableZ: [0], portPoints: [{ connectionName: "signal", x: -2, y: 0, z: 0 }, { connectionName: "signal", x: 2, y: 0, z: 0 }] }
  const obstacles = [{ type: "rect" as const, center: { x: -2, y: 0.15 }, width: 0.2, height: 0.2, layers: ["top"], connectedTo: ["unrelated"] }]
  const options = { nodeWithPortPoints: node, traceWidth: 0.1, viaDiameter: 0.3, obstacleMargin: 0.15, layerCount: 2, obstacles }
  const native = new PortfolioSingleIntraNodeSolver(options)
  native.solve()
  expect(native.solved).toBe(true)
  const model = new ContextualComputeSelectionModel()
  const adaptive = new PortfolioSingleIntraNodeSolver({ ...options, computeSelectionModel: model })
  adaptive.solve()
  expect(adaptive.solved).toBe(true)
  expect(adaptive.failed).toBe(false)
  expect(adaptive.solvedRoutes).toEqual(native.solvedRoutes)
  expect(validateComputeSelectionOutcome({ routes: adaptive.solvedRoutes, node, ...options, validationScope: "physical" })).toBe(false)
  expect(model.getStats().learnedComputeValidOutcomeCount).toBe(0)
  expect(model.getStats().learnedComputeCensoredOutcomeCount).toBeGreaterThan(0)
  expect(adaptive.stats.learnedComputePendingPhysicalWinnerCount).toBe(1)
})
