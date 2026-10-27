import { expect, test } from "bun:test"
import { PortfolioSingleIntraNodeSolver } from "../../lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import { IntraNodeRouteSolver } from "../../lib/solvers/HighDensitySolver/IntraNodeSolver"
import { minimumDistanceBetweenSegments } from "../../lib/utils/minimumDistanceBetweenSegments"
import type { Obstacle } from "../../lib/types/srj-types"

// Select one unchanged public portfolio group, retaining its real generated
// solver, parameters, scheduling, physical admission and iteration limits.
class OneOriginalNativeGroup extends PortfolioSingleIntraNodeSolver {
  override getCombinationDefs(): string[][] {
    return super.getCombinationDefs().filter(([name]) => name === "noVias")
  }
}

test("a grown world portfolio preserves a native child's declared allowance after setup", () => {
  const bounds = { minX: -2.5, maxX: 2.5, minY: -2.5, maxY: 2.5 }
  const start = { x: -0.3, y: 0, z: 0 }, end = { x: 0.3, y: 0, z: 0 }
  const node = { capacityMeshNodeId: "world-wall", center: { x: 0, y: 0 }, width: 1, height: 1,
    availableZ: [0], portPoints: [
      { ...start, connectionName: "moving", rootConnectionName: "moving" },
      { ...end, connectionName: "moving", rootConnectionName: "moving" },
    ] }
  const wall: Obstacle = { type: "rect", center: { x: 0, y: 0 }, width: 0.1, height: 3,
    layers: ["top"], zLayers: [0], connectedTo: ["foreign"] }
  const inputBefore = JSON.stringify({ node, wall, bounds })
  const portfolio = new OneOriginalNativeGroup({ nodeWithPortPoints: node, nativeGridOnly: true,
    routingBounds: bounds, obstacles: [wall], boardGeometry: { bounds }, layerCount: 1,
    traceWidth: 0.1, viaDiameter: 0.3, traceToPadClearance: 0.1, traceToHoleClearance: 0.2,
    viaToPadClearance: 0.1, captureSearchDebug: false })
  portfolio.initializeSolvers()
  expect(portfolio.supervisedSolvers).toHaveLength(1)
  const initialSupervisorLimit = portfolio.MAX_ITERATIONS
  const native = portfolio.supervisedSolvers![0]!.solver
  expect(native).toBeInstanceOf(IntraNodeRouteSolver)
  if (!(native instanceof IntraNodeRouteSolver)) throw new Error("Expected the original native noVias candidate")
  expect(native.hyperParameters.CELL_SIZE_FACTOR).toBe(2)
  expect(native.hyperParameters.VIA_PENALTY_FACTOR_2).toBe(10)

  // Observe the real child after the first scheduled source batch; do not
  // alter its state, limits, route, queue or any solver method.
  portfolio.step()
  expect(native.activeSubSolver).not.toBeNull()
  const child = native.activeSubSolver!
  expect(child.MAX_ITERATIONS).toBe(10000)
  portfolio.solve()
  expect(portfolio.solved).toBe(true)
  expect(portfolio.failed).toBe(false)
  expect(portfolio.error).toBeNull()
  expect(portfolio.iterations).toBeGreaterThan(initialSupervisorLimit)
  expect(native.solved).toBe(true)
  expect(child.solved).toBe(true)
  expect(child.failed).toBe(false)
  expect(child.iterations).toBeGreaterThan(1000)
  expect(child.iterations).toBeLessThan(child.MAX_ITERATIONS)
  expect(child.MAX_ITERATIONS).toBe(10000)
  expect(portfolio.solvedRoutes).toHaveLength(1)
  const route = portfolio.solvedRoutes[0]!
  expect(route.route[0]).toEqual(start)
  expect(route.route.at(-1)).toEqual(end)
  expect(route.vias).toEqual([])
  expect(route.route.every((point) => point.z === 0)).toBe(true)
  const corners = [{ x: -0.05, y: -1.5 }, { x: 0.05, y: -1.5 },
    { x: 0.05, y: 1.5 }, { x: -0.05, y: 1.5 }]
  for (let i = 1; i < route.route.length; i++) {
    const a = route.route[i - 1]!, b = route.route[i]!
    const gap = Math.min(...corners.map((corner, j) =>
      minimumDistanceBetweenSegments(a, b, corner, corners[(j + 1) % 4]!)))
    expect(gap + 1e-9).toBeGreaterThanOrEqual(0.15)
  }
  expect(JSON.stringify({ node, wall, bounds })).toBe(inputBefore)
})
