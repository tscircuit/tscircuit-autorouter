import { expect, test } from "bun:test"
import { FixedCopperClearanceIndex } from "lib/data-structures/FixedCopperClearanceIndex"
import {
  type Node,
  SingleRouteCandidatePriorityQueue,
} from "lib/data-structures/SingleRouteCandidatePriorityQueue"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"

test("physical routing anchors its grid at the exact start and checks exact-goal connector interiors", (): void => {
  const startIndex = new FixedCopperClearanceIndex({
    rectangles: [
      {
        kind: "fixed-rectangle",
        center: { x: 0.0455, y: 0 },
        width: 0.002,
        height: 0.002,
        zLayers: [0],
        ownerNetIds: new Set(["pad-net"]),
      },
    ],
    layerCount: 2,
    minClearance: 0,
  })
  const start = { x: 0.041, y: 0, z: 0 }
  const startSolver = new SingleHighDensityRouteSolver({
    connectionName: "route-net",
    obstacleRoutes: [],
    minDistBetweenEnteringPoints: 0.05,
    bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
    A: start,
    B: { x: 0.4, y: 0.2, z: 0 },
    traceThickness: 0.002,
    availableZ: [0],
    hyperParameters: { CELL_SIZE_FACTOR: 2 },
    futureConnections: [
      {
        connectionName: "future-net",
        points: [{ x: -0.8, y: 0.8, z: 0 }],
      },
    ],
    physicalClearanceContext: {
      traceClearanceIndex: startIndex,
      viaClearanceIndex: startIndex,
      traceToTraceClearance: 0.1,
      viaToTraceClearance: 0.1,
      canonicalNetId: "route-net",
      solveToPhysicalTransform: { center: { x: 0, y: 0 }, scale: 1 },
    },
  })
  for (const point of [start, { x: 0.05, y: 0, z: 0 }]) {
    expect(
      startIndex.isPointClear({
        point,
        canonicalNetId: "route-net",
        copperDiameter: 0.002,
      }),
    ).toBeTrue()
  }
  expect(startSolver.candidates.peek()).toMatchObject({
    ...start,
    parent: null,
  })
  expect(startSolver.initialNodeGridOffset).toEqual({ x: start.x, y: 0 })

  const goalIndex = new FixedCopperClearanceIndex({
    rectangles: [
      {
        kind: "fixed-rectangle",
        center: { x: 0.05, y: 0 },
        width: 0.02,
        height: 0.02,
        zLayers: [0],
        ownerNetIds: new Set(["pad-net"]),
      },
    ],
    layerCount: 2,
    minClearance: 0.01,
  })
  for (const blocked of [true, false]) {
    const solver = new SingleHighDensityRouteSolver({
      connectionName: "route-net",
      obstacleRoutes: [],
      minDistBetweenEnteringPoints: 0.05,
      bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
      A: { x: -0.5, y: 0, z: 0 },
      B: { x: 0.1, y: 0, z: 0 },
      traceThickness: 0.02,
      availableZ: [0],
      hyperParameters: { CELL_SIZE_FACTOR: 2 },
      physicalClearanceContext: {
        traceClearanceIndex: goalIndex,
        viaClearanceIndex: goalIndex,
        traceToTraceClearance: 0.1,
        viaToTraceClearance: 0.1,
        canonicalNetId: "route-net",
        solveToPhysicalTransform: { center: { x: 0, y: 0 }, scale: 1 },
      },
    })
    const parent: Node = { ...solver.A, g: 0, h: 0, f: 0, parent: null }
    const current: Node = {
      x: blocked ? 0 : 0.1,
      y: blocked ? 0 : 0.1,
      z: 0,
      g: 0,
      h: 0,
      f: 0,
      parent,
    }
    expect(solver.solved).toBeFalse()
    solver.candidates = new SingleRouteCandidatePriorityQueue([current])
    solver.step()
    expect(solver.failed).toBeFalse()
    expect(solver.solved).toBe(!blocked)
    if (blocked) {
      expect(solver.solvedPath).toBeNull()
    } else {
      expect(solver.solvedPath?.route.at(-1)).toEqual(solver.B)
    }
  }
})
