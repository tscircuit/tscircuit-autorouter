import { expect, test } from "bun:test"
import { SparsePhysicalSingleRouteSolver } from "lib/solvers/HighDensitySolver/SparsePhysicalSingleRouteSolver"
import { sparseOptions } from "./fixtures"

test("an unrouted future chord may detour while actual future copper and terminals remain obstacles", (): void => {
  const future = {
    connectionName: "future",
    points: [
      { x: 2, y: 5, z: 0 },
      { x: 8, y: 5, z: 0 },
    ],
  }
  const clear = new SparsePhysicalSingleRouteSolver({
    ...sparseOptions,
    futureConnections: [future],
  })
  expect(
    clear.isViaTooCloseToFutureConnectionTrace({
      x: 5,
      y: 5,
      z: 1,
      g: 0,
      h: 0,
      f: 0,
      parent: null,
    }),
  ).toBe(true)
  expect(
    clear.isSparseEdgeLegal({
      start: { x: 5, y: 5, z: 0 },
      end: { x: 5, y: 5, z: 1 },
    }),
  ).toBe(true)
  expect(
    clear.isSparseEdgeLegal({
      start: { x: 2, y: 5, z: 0 },
      end: { x: 2, y: 5, z: 1 },
    }),
  ).toBe(false)
  const occupied = new SparsePhysicalSingleRouteSolver({
    ...sparseOptions,
    futureConnections: [future],
    obstacleRoutes: [
      {
        connectionName: future.connectionName,
        traceThickness: 0.2,
        viaDiameter: 0.4,
        route: future.points,
        vias: [],
      },
    ],
  })
  expect(
    occupied.isSparseEdgeLegal({
      start: { x: 5, y: 5, z: 0 },
      end: { x: 5, y: 5, z: 1 },
    }),
  ).toBe(false)
})
