import { expect, test } from "bun:test"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import { SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost as Native } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver6_VertHorzLayer_FutureCost"
import type { Node } from "lib/data-structures/SingleRouteCandidatePriorityQueue"

type Point = { x: number; y: number; z: number }

const options = (
  points: Point[],
  enabled: boolean,
): ConstructorParameters<typeof Native>[0] => ({
  connectionName: "active",
  obstacleRoutes: [],
  minDistBetweenEnteringPoints: 0.1,
  bounds: { minX: -2, maxX: 2, minY: -2, maxY: 2 },
  A: { x: -1, y: -1, z: 0 },
  B: { x: 1, y: 1, z: 1 },
  futureConnections: [{ connectionName: "future", points }],
  layerCount: 6,
  captureSearchDebug: false,
  useFuturePointCertificates: enabled,
})

const query = (x: number, z = 0): Node => ({
  x,
  y: 0,
  z,
  g: 0,
  h: 0,
  f: 0,
  parent: null,
})

test("certificates retain public and owned scene contracts", () => {
  const near = { x: 0, y: 0, z: 0 }
  const far = { x: 10, y: 10, z: 1 }
  const solver = new Native(options([near, far], true))
  expect(solver.getClosestFutureConnectionPoint(query(0))).toBe(near)
  const anchor = Reflect.get(solver, "futurePointAnchors")[0]
  expect(anchor).toBeDefined()
  expect(solver.getClosestFutureConnectionPoint(query(0.01))).toBe(near)
  expect(Reflect.get(solver, "futurePointAnchors")[0]).toBe(anchor)
  expect(anchor.x).toBe(0)
  const originalPenalty = anchor.viaPenaltyDistance

  solver.VIA_PENALTY_FACTOR *= 2
  solver.getClosestFutureConnectionPoint(query(0.02))
  expect(Reflect.get(solver, "futurePointAnchors")[0]).toBe(anchor)
  expect(anchor.viaPenaltyDistance).not.toBe(originalPenalty)
  expect(anchor.x).toBe(0.02)

  solver.futureConnectionPoints = [{ x: 2 ** 21, y: 0, z: 0 }, far]
  expect(solver.getClosestFutureConnectionPoint(query(0.03))).toBe(far)
  expect(Reflect.get(solver, "certificateSceneEligible")).toBe(false)
  expect(Reflect.get(solver, "futurePointAnchors").length).toBe(0)
  solver.futureConnectionPoints = [near]
  expect(solver.getClosestFutureConnectionPoint(query(0.04))).toBe(near)
  expect(Reflect.get(solver, "futurePointAnchors")[0].runnerUp).toBe(Infinity)
  solver.futureConnectionPoints = []
  expect(solver.getClosestFutureConnectionPoint(query(0.05))).toBeNull()

  const mutable = new Native(options([near, far], false))
  expect(mutable.getClosestFutureConnectionPoint(query(0))).toBe(near)
  far.x = 0.01
  far.y = 0
  far.z = 0
  expect(mutable.getClosestFutureConnectionPoint(query(0.01))).toBe(far)
  expect(Reflect.get(mutable, "futurePointAnchors").length).toBe(0)

  for (const value of [2 ** 20, 2 ** 20 + 1, -Infinity, Infinity, NaN]) {
    const points = [
      { x: -(2 ** 20), y: 2 ** 20, z: 0 },
      { x: 2 ** 20, y: -(2 ** 20), z: 1 },
    ]
    const enabled = new Native(options(points, true))
    const ordinary = new Native(options(points, false))
    for (const z of [0, 1, 5]) {
      const node = query(value, z)
      expect(enabled.getClosestFutureConnectionPoint(node)).toBe(
        ordinary.getClosestFutureConnectionPoint(node),
      )
    }
  }

  const descriptor = Object.getOwnPropertyDescriptor(
    SingleHighDensityRouteSolver.prototype,
    "viaPenaltyDistance",
  )!
  try {
    Object.defineProperty(
      SingleHighDensityRouteSolver.prototype,
      "viaPenaltyDistance",
      { configurable: true, get: () => 4 },
    )
    const custom = new Native(options([near, far], true))
    custom.getClosestFutureConnectionPoint(query(0.07))
    expect(Reflect.get(custom, "useFuturePointCertificates")).toBe(false)
  } finally {
    Object.defineProperty(
      SingleHighDensityRouteSolver.prototype,
      "viaPenaltyDistance",
      descriptor,
    )
  }

  class CustomNative extends Native {
    override getNodeKey(node: Node): number {
      return super.getNodeKey(node) + 1
    }
  }
  const custom = new CustomNative(options([near, far], true))
  custom.getClosestFutureConnectionPoint(query(0.08))
  expect(Reflect.get(custom, "useFuturePointCertificates")).toBe(false)
})
