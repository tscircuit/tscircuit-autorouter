import { expect, test } from "bun:test"
import { SingleHighDensityRouteSolver } from "../../lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import { createPhysicalGridGuards } from "../../lib/solvers/HighDensitySolver/createPhysicalGridGuards"
import type { Node } from "../../lib/data-structures/SingleRouteCandidatePriorityQueue"
import type { SingleTransitionBoardContext } from "../../lib/solvers/HighDensitySolver/findSingleTransitionVia"
import type { Obstacle } from "../../lib/types/srj-types"

const point = (x: number, y: number, z = 0): Node => ({
  x,
  y,
  z,
  g: 0,
  h: 0,
  f: 0,
  parent: null,
})

test("physical grid keys preserve exact half-phase, boundary, layer and fallback coordinate identities", () => {
  for (const origin of [0, -1, 197.6]) {
    const bounds = { minX: origin - 0.29, maxX: origin + 0.29, minY: -0.29, maxY: 0.29 }
    const solver = new SingleHighDensityRouteSolver({ connectionName: "moving", bounds,
      A: { x: origin + 0.135, y: 0.135, z: 0 }, B: { x: origin - 0.135, y: -0.135, z: 0 },
      obstacleRoutes: [], minDistBetweenEnteringPoints: 0.05, availableZ: [0], layerCount: 8,
      traceThickness: 0.1, viaDiameter: 0.3, obstacleMargin: 0, captureSearchDebug: false,
      futureConnections: [{ connectionName: "later", points: [{ x: origin, y: 0, z: 0 }] }] })
    expect(solver.cellStep).toBe(0.05)
    const seed = solver.candidates.peek()!
    const seen = new Map<number, string>()
    const record = (p: Node) => {
      const key = solver.getNodeKey(p)
      expect(Number.isSafeInteger(key) && key > 0).toBe(true)
      const identity = `${p.x},${p.y},${p.z}`
      if (seen.has(key)) expect(seen.get(key)).toBe(identity)
      else seen.set(key, identity)
      expect(solver.getNodeKey({ ...p })).toBe(key)
    }
    const xs = [bounds.minX, bounds.maxX]
    const ys = [bounds.minY, bounds.maxY]
    for (let i = -12; i <= 12; i++) {
      const x = seed.x + i * solver.cellStep, y = seed.y + i * solver.cellStep
      if (x > bounds.minX && x < bounds.maxX) xs.push(x)
      if (y > bounds.minY && y < bounds.maxY) ys.push(y)
    }
    for (const z of [0, 1, 7]) for (const x of xs) for (const y of ys) record(point(x, y, z))
    expect(solver.getNodeKey(point(origin + 0.125, 0.125)))
      .not.toBe(solver.getNodeKey(point(origin + 0.175, 0.125)))
    // A clipped max creates a distinct inward phase: .29 -> .24 must not alias .225.
    const boundary = point(bounds.maxX, seed.y)
    record(boundary)
    const inward = solver.getNeighbors(boundary).find((p) => p.x < bounds.maxX && p.y === seed.y)!
    expect(inward).toBeDefined()
    record(inward)
    record(point(origin + 0.225, seed.y))
    expect(solver.getNodeKey(inward)).not.toBe(solver.getNodeKey(point(origin + 0.225, seed.y)))
    // Key identity must not invent a physical epsilon or merge nearby clearance-boundary states.
    record(point(origin + 0.125 + 1e-10, 0.125))
    expect(solver.getNodeKey(point(origin + 0.125, 0.125)))
      .not.toBe(solver.getNodeKey(point(origin + 0.125 + 1e-10, 0.125)))
    expect(solver.MAX_ITERATIONS).toBe(10_000)
    solver.debugEnabled = true
    solver.step()
    expect(solver.debug_exploredNodesOrdered[0]!.x).toBe(seed.x)
    expect(solver.debug_exploredNodesOrdered[0]!.y).toBe(seed.y)
  }

  const bounds = { minX: -1, maxX: 1, minY: -1, maxY: 1 }
  const tiny: Obstacle = { type: "rect", shape: "circle", center: { x: 0.075, y: 0 },
    width: 0.0002, height: 0.0002, layers: ["top"], zLayers: [0], connectedTo: ["foreign"] }
  const context: SingleTransitionBoardContext = { obstacles: [tiny], layerCount: 8, coordinateScale: 1,
    allowBlindAndBuriedVias: false, traceToPadClearance: 0, traceToHoleClearance: 0.2,
    viaToPadClearance: 0.1, boardGeometry: { bounds } }
  const guards = createPhysicalGridGuards({ context, bounds, center: { x: 0, y: 0 }, connectionName: "moving",
    traceWidth: 0.1, viaDiameter: 0.3 })
  const start = { x: 0.024, y: 0, z: 0 }
  expect(guards.wireAllowed(start, start)).toBe(true)
  expect(guards.wireAllowed({ ...start, x: 0.025 }, { ...start, x: 0.025 })).toBe(false)
  const fallback = new SingleHighDensityRouteSolver({ connectionName: "moving", bounds,
    A: start, B: { x: 0.8, y: 0, z: 0 }, obstacleRoutes: [], minDistBetweenEnteringPoints: 0.05,
    layerCount: 8, availableZ: [0], traceThickness: 0.1, viaDiameter: 0.3,
    physicalGuards: guards, captureSearchDebug: false })
  expect(fallback.candidates.peek()!.x).toBe(start.x)
  expect(fallback.initialNodeGridOffset.x + Math.round(start.x / fallback.cellStep) * fallback.cellStep).toBe(start.x)
  expect(fallback.initialNodeGridOffset.y).toBe(start.y)
  const keys = new Set<number>()
  for (let i = -5; i <= 5; i++) keys.add(fallback.getNodeKey(point(start.x + i * fallback.cellStep, 0)))
  expect(keys.size).toBe(11)
  expect(fallback.getNodeKey(point(start.x, 0))).not.toBe(fallback.getNodeKey(point(0.025, 0)))
  expect(start).toEqual({ x: 0.024, y: 0, z: 0 })
})
