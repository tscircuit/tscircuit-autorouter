import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SparsePhysicalSingleRouteSolver } from "lib/solvers/HighDensitySolver/SparsePhysicalSingleRouteSolver"
import { sparseOptions } from "./fixtures"

test("future terminal copper reserves its actual layer while connected terminals remain reusable", (): void => {
  const futureConnections = [
    {
      connectionName: "future",
      points: [{ x: 5, y: 5, z: 2 }],
    },
  ]
  const solver = new SparsePhysicalSingleRouteSolver({
    ...sparseOptions,
    futureConnections,
  })
  expect(
    solver.isSparseEdgeLegal({
      start: { x: 1, y: 5, z: 2 },
      end: { x: 9, y: 5, z: 2 },
    }),
  ).toBe(false)
  expect(
    solver.isSparseEdgeLegal({ start: sparseOptions.A, end: sparseOptions.B }),
  ).toBe(true)
  expect(
    solver.isSparseEdgeLegal({
      start: { x: 5, y: 5, z: 0 },
      end: { x: 5, y: 5, z: 1 },
    }),
  ).toBe(false)
  const blind = new SparsePhysicalSingleRouteSolver({
    ...sparseOptions,
    futureConnections,
    allowBlindAndBuriedVias: true,
  })
  expect(
    blind.isSparseEdgeLegal({
      start: { x: 5, y: 5, z: 0 },
      end: { x: 5, y: 5, z: 1 },
    }),
  ).toBe(true)
  const connected = new SparsePhysicalSingleRouteSolver({
    ...sparseOptions,
    futureConnections,
    connMap: new ConnectivityMap({ net: ["a", "future"] }),
  })
  expect(
    connected.isSparseEdgeLegal({
      start: { x: 1, y: 5, z: 2 },
      end: { x: 9, y: 5, z: 2 },
    }),
  ).toBe(true)
})
