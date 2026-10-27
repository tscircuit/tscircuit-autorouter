import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { SparsePhysicalSingleRouteSolver } from "lib/solvers/HighDensitySolver/SparsePhysicalSingleRouteSolver"
import { crossingWire, sparseOptions, throughVia } from "./fixtures"

test("mutable owner contexts exempt net copper but preserve drill spacing and exact reuse compatibility", (): void => {
  const options = {
    ...sparseOptions,
    obstacleRoutes: [crossingWire, throughVia],
  }
  const connMap = new ConnectivityMap({ net: ["a", "b"] })
  const same = new SparsePhysicalSingleRouteSolver({ ...options, connMap })
  expect(
    same.isSparseEdgeLegal({ start: sparseOptions.A, end: sparseOptions.B }),
  ).toBe(true)
  expect(
    same.isSparseEdgeLegal({
      start: { x: 5.2, y: 5, z: 0 },
      end: { x: 5.2, y: 5, z: 1 },
    }),
  ).toBe(false)
  expect(
    same.isSparseEdgeLegal({
      start: { x: 5, y: 5, z: 0 },
      end: { x: 5, y: 5, z: 1 },
    }),
  ).toBe(true)
  const smaller = new SparsePhysicalSingleRouteSolver({
    ...options,
    connMap,
    viaDiameter: 0.5,
  })
  expect(
    smaller.isSparseEdgeLegal({
      start: { x: 5, y: 5, z: 0 },
      end: { x: 5, y: 5, z: 1 },
    }),
  ).toBe(false)
  const foreign = new SparsePhysicalSingleRouteSolver(options)
  expect(
    foreign.isSparseEdgeLegal({ start: sparseOptions.A, end: sparseOptions.B }),
  ).toBe(false)
  const alias = new SparsePhysicalSingleRouteSolver({
    ...options,
    connMap: new ConnectivityMap({ net0: ["a"], net1: ["b", "net0"] }),
  })
  expect(
    alias.isSparseEdgeLegal({ start: sparseOptions.A, end: sparseOptions.B }),
  ).toBe(false)
})
