import { expect, test } from "bun:test"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import { CachedIntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/CachedIntraNodeRouteSolver"
import type { StaticRouteSegment } from "lib/types/high-density-types"

test("grown native edge guards receive original coordinates, owners and copper diameters", (): void => {
  const node = {
    capacityMeshNodeId: "translated-four-times",
    center: { x: 10, y: 20 },
    width: 2,
    height: 2,
    availableZ: [0, 1],
    portPoints: [
      {
        x: 9,
        y: 19,
        z: 0,
        connectionName: "child",
        rootConnectionName: "declared-owner",
      },
      {
        x: 11,
        y: 21,
        z: 1,
        connectionName: "child",
        rootConnectionName: "declared-owner",
      },
    ],
  }
  const original = structuredClone(node)
  const calls: StaticRouteSegment[] = []
  const solver = new GrowShrinkHighDensityIntraNodeSolver({
    nodeWithPortPoints: node,
    traceWidth: 0.1,
    viaDiameter: 0.3,
    obstacleMargin: 0.15,
    staticSegmentValidator: (segment) => {
      calls.push(structuredClone(segment))
      return true
    },
  })
  // Select an existing growth attempt directly; this test exercises its real
  // native candidate without a different closed-form winner ending the test.
  solver.scaleFactor = 4
  ;(
    solver as unknown as { createActiveSubSolver(): void }
  ).createActiveSubSolver()
  const candidate = solver.activeSubSolver!.generateSolver(
    {},
  ) as CachedIntraNodeRouteSolver
  expect(candidate.nodeWithPortPoints.width).toBe(8)
  expect(candidate.nodeWithPortPoints.center).toEqual({ x: 10, y: 20 })
  candidate.solve()
  expect(candidate.solved).toBe(true)
  expect(calls.length).toBeGreaterThan(0)
  expect(calls.some((call) => call.start.z !== call.end.z)).toBe(true)
  for (const call of calls) {
    expect(call.connectionName).toBe("child")
    expect(call.rootConnectionName).toBe("declared-owner")
    expect(call.traceThickness).toBe(0.1)
    expect(call.viaDiameter).toBe(0.3)
    for (const point of [call.start, call.end]) {
      expect(point.x).toBeGreaterThanOrEqual(9)
      expect(point.x).toBeLessThanOrEqual(11)
      expect(point.y).toBeGreaterThanOrEqual(19)
      expect(point.y).toBeLessThanOrEqual(21)
    }
  }
  expect(calls[0]!.start).toEqual({ x: 9, y: 19, z: 0 })
  expect(node).toEqual(original)
})
