import { expect, test } from "bun:test"
import { pointToBoxDistance, segmentToBoxMinDistance } from "@tscircuit/math-utils"
import { SingleTransitionIntraNodeSolver } from "../../lib/solvers/HighDensitySolver/SingleTransitionIntraNodeSolver"
import type { SingleTransitionBoardContext } from "../../lib/solvers/HighDensitySolver/findSingleTransitionVia"
import { hasViaObstacleCollision } from "../../lib/solvers/HyperHighDensitySolver/hasViaObstacleCollision"
import type { NodeWithPortPoints } from "../../lib/types/high-density-types"
import type { Obstacle } from "../../lib/types/srj-types"
import { isOpaqueUnownedObstacle } from "../../lib/utils/isOpaqueUnownedObstacle"

type Point = { x: number; y: number; z: number }
type Bounds = { minX: number; maxX: number; minY: number; maxY: number }
type Fixture = {
  solver: SingleTransitionIntraNodeSolver
  node: NodeWithPortPoints
  context: SingleTransitionBoardContext
}

function makeFixture(start: Point, end: Point, obstacle: Obstacle, bounds: Bounds, scale = 1): Fixture {
  const center = { x: (start.x + end.x) / 2, y: 0 }
  const ports = [start, end].map((point, index) => ({
    x: scale === 1 ? point.x : center.x + (point.x - center.x) * scale,
    y: scale === 1 ? point.y : center.y + (point.y - center.y) * scale,
    z: point.z,
    connectionName: "signal", rootConnectionName: "signal",
    portPointId: index === 0 ? "a" : "b",
    ...(index === 0 ? { nextPortPointId: "b" } : { prevPortPointId: "a" }),
  }))
  const node: NodeWithPortPoints = {
    capacityMeshNodeId: "natural-transition", center, width: 2 * scale, height: 2 * scale,
    portPoints: ports, availableZ: [1, 5],
  }
  const context: SingleTransitionBoardContext = {
    obstacles: [obstacle], layerCount: 8, allowBlindAndBuriedVias: false,
    viaToPadClearance: 0.15, traceToPadClearance: 0.15,
    coordinateScale: scale, boardGeometry: { bounds },
  }
  const solver = new SingleTransitionIntraNodeSolver({
    nodeWithPortPoints: node, viaDiameter: 0.3, traceThickness: 0.1, boardContext: context,
  })
  return { solver, node, context }
}

function commonViaCollision(fixture: Fixture, obstacles: Obstacle[]): boolean {
  return hasViaObstacleCollision({
    routes: fixture.solver.solvedRoutes, obstacles,
    layerCount: fixture.context.layerCount,
    allowBlindAndBuriedVias: fixture.context.allowBlindAndBuriedVias,
    viaDiameter: 0.3, viaToPadClearance: fixture.context.viaToPadClearance,
    center: fixture.node.center, coordinateScale: fixture.context.coordinateScale,
  })
}

test("single transitions apply pad margins to typed copper while preserving opaque metal clearance", (): void => {
  const opaque: Obstacle = {
    type: "rect", obstacleId: "opaque-keepout", center: { x: 1.1, y: 0 },
    width: 1, height: 2, layers: ["inner1"], connectedTo: [],
  }
  const inputBefore = JSON.stringify(opaque)
  const start = { x: 0.549, y: 0, z: 1 }, end = { x: -0.8, y: 0.5, z: 5 }
  const wide = { minX: -2, maxX: 2, minY: -2, maxY: 2 }
  const wire = makeFixture(start, end, opaque, wide)
  expect(wire.solver.solved).toBe(true)
  expect(wire.solver.failed).toBe(false)
  expect(wire.context.traceToPadClearance).toBe(0.15)
  expect(wire.context.viaToPadClearance).toBe(0.15)
  expect(wire.solver.solvedRoutes).toHaveLength(1)
  const wireRoute = wire.solver.solvedRoutes[0]!
  expect(wireRoute.route[0]).toEqual(start)
  expect(wireRoute.route.at(-1)).toEqual(end)
  const gaps: number[] = []
  for (let index = 1; index < wireRoute.route.length; index++) {
    const a = wireRoute.route[index - 1]!, b = wireRoute.route[index]!
    if (a.z === 1 && b.z === 1) gaps.push(segmentToBoxMinDistance(a, b, opaque) - 0.05)
  }
  expect(gaps.length).toBeGreaterThan(0)
  expect(Math.min(...gaps)).toBeCloseTo(0.001, 10)
  expect(commonViaCollision(wire, [opaque])).toBe(false)

  const bottom: Obstacle = { ...opaque, layers: ["bottom"] }
  const narrow = { minX: 0.2, maxX: 0.9, minY: -0.5, maxY: 0.5 }
  const viaStart = { x: 0.27, y: 0, z: 1 }, viaEnd = { x: 0.6, y: 0, z: 5 }
  const via = makeFixture(viaStart, viaEnd, bottom, narrow)
  expect(via.solver.solved).toBe(true)
  expect(via.solver.failed).toBe(false)
  expect(via.context.viaToPadClearance).toBe(0.15)
  expect(via.solver.solvedRoutes[0]!.vias).toEqual([{ x: 0.435, y: 0 }])
  expect(pointToBoxDistance(via.solver.solvedRoutes[0]!.vias[0]!, bottom) - 0.15).toBeCloseTo(0.015, 10)
  expect(commonViaCollision(via, [bottom])).toBe(false)

  const typed: Obstacle[] = [
    { ...opaque, connectedTo: ["foreign-net"] },
    { ...opaque, isNonPlatedHole: true, shape: "circle" },
    { ...opaque, offBoardConnectsTo: ["foreign-net"] },
    ...["pcb_smtpad_id", "pcb_plated_hole_id", "pcb_port_id", "pcb_via_id"].map((key) => ({
      ...opaque, circuitJsonMetadata: { [key]: "foreign-copper" },
    })),
  ]
  for (const obstacle of typed) {
    expect(isOpaqueUnownedObstacle(obstacle)).toBe(false)
    const result = makeFixture(start, end, obstacle, wide)
    expect(result.solver.failed).toBe(true)
    expect(result.solver.solved).toBe(false)
    expect(commonViaCollision(via, [{ ...obstacle, layers: ["bottom"] }])).toBe(true)
  }
  const own: Obstacle = { ...opaque, connectedTo: ["signal"], circuitJsonMetadata: { pcb_smtpad_id: "own-pad" } }
  const ownResult = makeFixture(start, end, own, wide)
  expect(ownResult.solver.solved).toBe(true)
  expect(commonViaCollision(via, [{ ...own, layers: ["bottom"] }])).toBe(false)

  const wireOverlap = makeFixture({ ...start, x: 0.551 }, end, opaque, wide)
  expect(wireOverlap.solver.failed).toBe(true)
  expect(wireOverlap.solver.solved).toBe(false)
  const overlappingVia: Obstacle = { ...bottom, center: { x: 1.08, y: 0 } }
  expect(pointToBoxDistance(via.solver.solvedRoutes[0]!.vias[0]!, overlappingVia) - 0.15).toBeLessThan(0)
  expect(commonViaCollision(via, [overlappingVia])).toBe(true)
  const fullStackBlocker: Obstacle = { ...bottom, center: { x: 0.5, y: 0 }, width: 2 }
  const excludedLayer = makeFixture(viaStart, viaEnd, fullStackBlocker, narrow)
  expect(excludedLayer.node.availableZ).toEqual([1, 5])
  expect(excludedLayer.solver.failed).toBe(true)
  expect(excludedLayer.solver.solved).toBe(false)

  for (const scale of [0.5, 2, 4]) {
    const scaled = makeFixture(start, end, opaque, wide, scale)
    expect(scaled.solver.solved).toBe(true)
    expect(commonViaCollision(scaled, [opaque])).toBe(false)
    const candidate = scaled.solver.solvedRoutes[0]!.vias[0]!
    const world = {
      x: scaled.node.center.x + (candidate.x - scaled.node.center.x) / scale,
      y: scaled.node.center.y + (candidate.y - scaled.node.center.y) / scale,
    }
    expect(world.x).toBeCloseTo(wireRoute.vias[0]!.x, 12)
    expect(world.y).toBeCloseTo(wireRoute.vias[0]!.y, 12)
    const scaledVia = makeFixture(viaStart, viaEnd, bottom, narrow, scale)
    expect(scaledVia.solver.solved).toBe(true)
    expect(commonViaCollision(scaledVia, [bottom])).toBe(false)
  }
  expect(JSON.stringify(opaque)).toBe(inputBefore)
})
