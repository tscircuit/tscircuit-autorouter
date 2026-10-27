import { expect, test } from "bun:test"
import { createPhysicalGridGuards } from "../../lib/solvers/HighDensitySolver/createPhysicalGridGuards"
import { SingleHighDensityRouteSolver } from "../../lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import type { SingleTransitionBoardContext } from "../../lib/solvers/HighDensitySolver/findSingleTransitionVia"
import type { Obstacle } from "../../lib/types/srj-types"

test("a rejected incoming physical edge does not close a reachable grid point", () => {
  const bounds = { minX: -0.4, maxX: 1.6, minY: -0.4, maxY: 0.8 }
  const obstacles: Obstacle[] = [
    {
      type: "rect", shape: "circle", center: { x: 0.2, y: 0.2 },
      width: 0.05, height: 0.05, layers: ["top"], zLayers: [0],
      connectedTo: ["foreign"],
    },
    {
      type: "rect", center: { x: 0.6, y: 0 },
      width: 0.05, height: 0.2, layers: ["top"], zLayers: [0],
      connectedTo: ["foreign"],
    },
  ]
  const context: SingleTransitionBoardContext = {
    obstacles, layerCount: 8, allowBlindAndBuriedVias: false,
    coordinateScale: 1, traceToPadClearance: 0.1,
    traceToHoleClearance: 0.2, viaToPadClearance: 0.1,
    boardGeometry: { bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 } },
  }
  const physicalGuards = createPhysicalGridGuards({
    context, bounds, center: { x: 0, y: 0 }, connectionName: "moving",
    traceWidth: 0.1, viaDiameter: 0.3,
  })
  const start = { x: 0, y: 0, z: 0 }
  const corner = { x: 0.4, y: 0.4, z: 0 }
  const top = { x: 0, y: 0.4, z: 0 }
  const goal = { x: 1.2, y: 0.4, z: 0 }
  expect(physicalGuards.wireAllowed(start, corner)).toBe(false)
  expect(physicalGuards.wireAllowed(corner, corner)).toBe(true)
  expect(physicalGuards.wireAllowed(start, top)).toBe(true)
  expect(physicalGuards.wireAllowed(top, corner)).toBe(true)
  expect(physicalGuards.wireAllowed(corner, goal)).toBe(true)
  const solver = new SingleHighDensityRouteSolver({
    connectionName: "moving", obstacleRoutes: [], bounds,
    A: start, B: goal, minDistBetweenEnteringPoints: 0.05,
    traceThickness: 0.1, viaDiameter: 0.3, obstacleMargin: 0.1,
    layerCount: 8, availableZ: [0], physicalGuards,
    hyperParameters: { CELL_SIZE_FACTOR: 8 }, captureSearchDebug: true,
  })
  expect(solver.cellStep).toBe(0.4)
  expect(solver.solved).toBe(false)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.solvedPath!.route[0]).toEqual(start)
  expect(solver.solvedPath!.route.at(-1)).toEqual(goal)
  expect(solver.solvedPath!.vias).toEqual([])
  for (let i = 1; i < solver.solvedPath!.route.length; i++) {
    expect(physicalGuards.wireAllowed(
      solver.solvedPath!.route[i - 1]!, solver.solvedPath!.route[i]!,
    )).toBe(true)
  }
  expect(obstacles[0]!.center).toEqual({ x: 0.2, y: 0.2 })
  expect(obstacles[1]!.center).toEqual({ x: 0.6, y: 0 })
})
