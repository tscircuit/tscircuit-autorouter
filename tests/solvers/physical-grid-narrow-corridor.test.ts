import { expect, test } from "bun:test"
import { createPhysicalGridGuards } from "../../lib/solvers/HighDensitySolver/createPhysicalGridGuards"
import { SingleHighDensityRouteSolver } from "../../lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import type { SingleTransitionBoardContext } from "../../lib/solvers/HighDensitySolver/findSingleTransitionVia"
import type { Obstacle } from "../../lib/types/srj-types"

test("physical grids preserve their native step through a legal narrow raw-pad corridor", () => {
  const bounds = { minX: -1, maxX: 1.5, minY: -1, maxY: 1 }
  const obstacles: Obstacle[] = [
    {
      type: "rect", center: { x: -1, y: 0 }, width: 1.94, height: 1,
      layers: ["top"], zLayers: [0], connectedTo: ["foreign-left"],
    },
    {
      type: "rect", center: { x: 1.18, y: 0 }, width: 1.64, height: 1,
      layers: ["top"], zLayers: [0], connectedTo: ["foreign-right"],
    },
  ]
  const context: SingleTransitionBoardContext = {
    obstacles, layerCount: 8, coordinateScale: 1,
    allowBlindAndBuriedVias: false, traceToPadClearance: 0.1,
    traceToHoleClearance: 0.2, viaToPadClearance: 0.1,
    boardGeometry: { bounds: { minX: -3, maxX: 3, minY: -2, maxY: 2 } },
  }
  const physicalGuards = createPhysicalGridGuards({
    context, bounds, center: { x: 0, y: 0 }, connectionName: "moving",
    traceWidth: 0.1, viaDiameter: 0.3,
  })
  const start = { x: 0.14, y: 0.69, z: 0 }
  const goal = { x: 0.19, y: -0.69, z: 0 }
  const opts = {
    connectionName: "moving", obstacleRoutes: [], bounds,
    A: start, B: goal, minDistBetweenEnteringPoints: 0.2,
    traceThickness: 0.1, viaDiameter: 0.3, obstacleMargin: 0.1,
    layerCount: 8, availableZ: [0], captureSearchDebug: false,
    futureConnections: [{ connectionName: "later", points: [
      { x: -0.7, y: 0.8, z: 0 }, { x: -0.5, y: 0.8, z: 0 },
    ] }],
  }
  expect(physicalGuards.wireAllowed(start, goal)).toBe(true)
  expect(physicalGuards.wireAllowed({ x: 0.1, y: 0, z: 0 }, { x: 0.1, y: 0, z: 0 })).toBe(false)
  expect(physicalGuards.wireAllowed({ x: 0.125, y: 0, z: 0 }, { x: 0.125, y: 0, z: 0 })).toBe(true)
  const solver = new SingleHighDensityRouteSolver({ ...opts, physicalGuards })
  expect(solver.solved).toBe(false)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.cellStep).toBe(0.05)
  expect(solver.MAX_ITERATIONS).toBe(10_000)
  expect(solver.solvedPath!.route[0]).toEqual(start)
  expect(solver.solvedPath!.route.at(-1)).toEqual(goal)
  expect(solver.solvedPath!.vias).toEqual([])
  for (let i = 1; i < solver.solvedPath!.route.length; i++) {
    expect(physicalGuards.wireAllowed(
      solver.solvedPath!.route[i - 1]!, solver.solvedPath!.route[i]!,
    )).toBe(true)
  }
  const legacy = new SingleHighDensityRouteSolver(opts)
  expect(legacy.cellStep).toBe(0.2)
  expect(legacy.MAX_ITERATIONS).toBe(10_000)
  expect(obstacles[0]!.width).toBe(1.94)
  expect(obstacles[1]!.width).toBe(1.64)
})
