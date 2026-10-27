import { expect, test } from "bun:test"
import { IntraNodeRouteSolver } from "../../lib/solvers/HighDensitySolver/IntraNodeSolver"
import { minimumDistanceBetweenSegments } from "../../lib/utils/minimumDistanceBetweenSegments"
import type { Obstacle } from "../../lib/types/srj-types"

test("a physical grid detour can finish its native child allowance before its parent stops", () => {
  const bounds = { minX: -2, maxX: 2, minY: -2, maxY: 2 }
  const start = { x: -0.3, y: 0, z: 0 }
  const end = { x: 0.3, y: 0, z: 0 }
  const wall: Obstacle = { type: "rect", center: { x: 0, y: 0 }, width: 0.1, height: 2,
    layers: ["top"], zLayers: [0], connectedTo: ["foreign"] }
  const node = { capacityMeshNodeId: "detour", center: { x: 0, y: 0 }, width: 1, height: 1,
    availableZ: [0], portPoints: [
      { ...start, connectionName: "moving", rootConnectionName: "moving" },
      { ...end, connectionName: "moving", rootConnectionName: "moving" },
    ] }
  const originalInput = JSON.stringify({ node, wall, bounds })
  const solver = new IntraNodeRouteSolver({ nodeWithPortPoints: node, obstacles: [wall],
    boardGeometry: { bounds }, routingBounds: bounds, layerCount: 1,
    traceWidth: 0.1, viaDiameter: 0.3, traceToPadClearance: 0.1,
    traceToHoleClearance: 0.2, viaToPadClearance: 0.1, captureSearchDebug: false })
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.error).toBeNull()
  // The wall requires more than the former one-connection parent allowance;
  // the real child completes within its unchanged native search allowance.
  expect(solver.iterations).toBeGreaterThan(1000)
  expect(solver.iterations).toBeLessThan(10000)
  expect(solver.solvedRoutes).toHaveLength(1)
  const route = solver.solvedRoutes[0]!
  expect(route.route[0]).toEqual(start)
  expect(route.route.at(-1)).toEqual(end)
  expect(route.vias).toEqual([])
  expect(route.route.every((p) => p.z === 0)).toBe(true)
  expect(Math.max(...route.route.map((p) => Math.abs(p.y)))).toBeGreaterThanOrEqual(1.15 - 1e-9)

  // Check every capsule against the four physical wall edges independently
  // of the grid admission callback, including the final goal connector.
  const corners = [{ x: -0.05, y: -1 }, { x: 0.05, y: -1 },
    { x: 0.05, y: 1 }, { x: -0.05, y: 1 }]
  for (let i = 1; i < route.route.length; i++) {
    const a = route.route[i - 1]!, b = route.route[i]!
    const distance = Math.min(...corners.map((corner, j) =>
      minimumDistanceBetweenSegments(a, b, corner, corners[(j + 1) % 4]!)))
    expect(distance + 1e-9).toBeGreaterThanOrEqual(0.05 + 0.1)
    expect([a, b].every((p) => Math.abs(p.x) <= 1.95 + 1e-9 && Math.abs(p.y) <= 1.95 + 1e-9)).toBe(true)
  }
  expect(JSON.stringify({ node, wall, bounds })).toBe(originalInput)

  const legacy = new IntraNodeRouteSolver({ nodeWithPortPoints: node,
    traceWidth: 0.1, viaDiameter: 0.3, captureSearchDebug: false })
  legacy.solve()
  expect(legacy.solved).toBe(true)
  expect(legacy.MAX_ITERATIONS).toBe(1000)
})
