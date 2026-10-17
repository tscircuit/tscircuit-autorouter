import { expect, test } from "bun:test"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import type { PortfolioSingleIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/PortfolioSingleIntraNodeSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("physical grow/shrink scales copper and obstacles with its coordinates", (): void => {
  const solver = new GrowShrinkHighDensityIntraNodeSolver({
    nodeWithPortPoints: {
      capacityMeshNodeId: "physical-node",
      center: { x: 10, y: 20 },
      width: 1,
      height: 1,
      availableZ: [0, 1],
      portPoints: [
        { x: 9.5, y: 20, z: 0, connectionName: "signal" },
        { x: 10.5, y: 20, z: 1, connectionName: "signal" },
      ],
    },
    minimumTraceWidth: 0.1524,
    traceWidth: 0.1524,
    viaDiameter: 0.2032,
    obstacleMargin: 0.1,
    obstacles: [
      {
        type: "rect",
        center: { x: 10.25, y: 20.5 },
        width: 0.1,
        height: 0.2,
        layers: ["top"],
        connectedTo: ["foreign"],
      },
    ],
    boardGeometry: {
      bounds: { minX: 0, maxX: 30, minY: 0, maxY: 40 },
      outline: [{ x: 0, y: 0 }],
      minBoardEdgeClearance: 0.1,
    },
  })
  const internal = solver as unknown as {
    createActiveSubSolver(): void
    acceptSolution(candidate: PortfolioSingleIntraNodeSolver): boolean
  }
  solver.scaleFactor = 4
  internal.createActiveSubSolver()
  const scaled = solver.activeSubSolver!.constructorParams
  expect(scaled.nodeWithPortPoints.width).toBe(4)
  expect(scaled.traceWidth).toBe(0.6096)
  expect(scaled.minimumTraceWidth).toBe(0.6096)
  expect(scaled.viaDiameter).toBe(0.8128)
  expect(scaled.obstacleMargin).toBe(0.4)
  expect(scaled.obstacles![0]).toMatchObject({
    center: { x: 11, y: 22 },
    width: 0.4,
    height: 0.8,
  })
  expect(scaled.boardGeometry).toEqual({
    bounds: { minX: -30, maxX: 90, minY: -60, maxY: 100 },
    outline: [{ x: -30, y: -60 }],
    minBoardEdgeClearance: 0.4,
  })
  const enlargedRoute: HighDensityRoute = {
    connectionName: "signal",
    traceThickness: 0.6096,
    viaDiameter: 0.8128,
    route: [{ x: 8, y: 20, z: 0, traceThickness: 0.6096 }],
    vias: [{ x: 10, y: 20 }],
  }
  expect(
    internal.acceptSolution({
      solvedRoutes: [enlargedRoute],
    } as PortfolioSingleIntraNodeSolver),
  ).toBeTrue()
  expect(solver.solvedRoutes[0]).toMatchObject({
    traceThickness: 0.1524,
    viaDiameter: 0.2032,
    route: [{ x: 9.5, y: 20, z: 0, traceThickness: 0.1524 }],
  })
})
