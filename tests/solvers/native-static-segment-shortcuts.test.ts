import { expect, test } from "bun:test"
import { segmentToBoundsMinDistance } from "@tscircuit/math-utils"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import type { StaticSegmentValidator } from "lib/types/high-density-types"

test("static geometry guards native direct, rounded-start, goal and endpoint-via shortcuts", (): void => {
  const defaults = {
    connectionName: "signal",
    rootConnectionName: "declared-owner",
    obstacleRoutes: [],
    minDistBetweenEnteringPoints: 0,
    bounds: { minX: -1, maxX: 1, minY: -1, maxY: 1 },
    viaDiameter: 0.3,
    traceThickness: 0.001,
    obstacleMargin: 0.15,
    layerCount: 2,
    availableZ: [0, 1],
    captureSearchDebug: false,
  }
  const cases = [
    {
      A: { x: -0.8, y: 0, z: 0 },
      B: { x: 0.8, y: 0, z: 0 },
      barrier: { minX: 0.77, maxX: 0.78, minY: -0.02, maxY: 0.02 },
      futureConnections: [],
    },
    {
      A: { x: 0.013, y: 0.013, z: 0 },
      B: { x: 0.6, y: 0.6, z: 0 },
      barrier: { minX: 0.018, maxX: 0.02, minY: 0.018, maxY: 0.02 },
      // Keep this case in the ordinary search so it exercises rounded seeding.
      futureConnections: [
        {
          connectionName: "future",
          points: [
            { x: -1, y: -1, z: 0 },
            { x: -0.9, y: -0.9, z: 0 },
          ],
        },
      ],
    },
  ]
  for (const entry of cases) {
    const valid: StaticSegmentValidator = (segment) =>
      segment.start.z !== segment.end.z ||
      segmentToBoundsMinDistance(segment.start, segment.end, entry.barrier) >=
        segment.traceThickness / 2
    const plain = new SingleHighDensityRouteSolver({ ...defaults, ...entry })
    plain.solve()
    expect(plain.solved).toBe(true)
    expect(
      plain.solvedPath!.route.some(
        (point, index, points) =>
          index > 0 &&
          !valid({ ...defaults, start: points[index - 1]!, end: point }),
      ),
    ).toBe(true)
    const guarded = new SingleHighDensityRouteSolver({
      ...defaults,
      ...entry,
      staticSegmentValidator: valid,
    })
    guarded.solve()
    expect(guarded.failed).toBe(false)
    expect(guarded.solved).toBe(true)
    expect(guarded.solvedPath!.route[0]).toEqual(entry.A)
    expect(guarded.solvedPath!.route.at(-1)).toEqual(entry.B)
    for (let index = 1; index < guarded.solvedPath!.route.length; index++) {
      expect(
        valid({
          ...defaults,
          start: guarded.solvedPath!.route[index - 1]!,
          end: guarded.solvedPath!.route[index]!,
        }),
      ).toBe(true)
    }
  }
  const outsideCenter: StaticSegmentValidator = ({ start, end }) =>
    start.z === end.z || Math.hypot(start.x, start.y) >= 0.2
  const centered = {
    ...defaults,
    A: { x: -0.8, y: 0, z: 0 },
    B: { x: 0.8, y: 0, z: 1 },
  }
  const legacy = new SingleHighDensityRouteSolver(centered)
  expect(legacy.solved).toBe(true)
  expect(legacy.solvedPath!.vias).toEqual([{ x: 0, y: 0 }])
  const guardedCenter = new SingleHighDensityRouteSolver({
    ...centered,
    staticSegmentValidator: outsideCenter,
  })
  expect(guardedCenter.solved).toBe(false)
  guardedCenter.solve()
  expect(guardedCenter.solved).toBe(true)
  expect(
    guardedCenter.solvedPath!.vias.every(
      (via) => Math.hypot(via.x, via.y) >= 0.2,
    ),
  ).toBe(true)

  const aboveEndpoint: StaticSegmentValidator = ({ start, end }) =>
    start.z === end.z || start.y >= 0.4
  const endpoint = new IntraNodeRouteSolver({
    nodeWithPortPoints: {
      capacityMeshNodeId: "same-point-transition",
      center: { x: 0, y: 0 },
      width: 2,
      height: 2,
      availableZ: [0, 1],
      portPoints: [
        { x: 0, y: 0, z: 0, connectionName: "signal" },
        { x: 0, y: 0, z: 1, connectionName: "signal" },
      ],
    },
    viaDiameter: 0.3,
    traceWidth: 0.1,
    obstacleMargin: 0.15,
    staticSegmentValidator: aboveEndpoint,
  })
  endpoint.solve()
  expect(endpoint.failed).toBe(false)
  expect(endpoint.solved).toBe(true)
  expect(endpoint.solvedRoutes).toHaveLength(1)
  expect(endpoint.solvedRoutes[0]!.vias).toHaveLength(1)
  expect(endpoint.solvedRoutes[0]!.vias[0]!.y).toBeGreaterThanOrEqual(0.4)
  expect(endpoint.solvedRoutes[0]!.route[0]).toEqual({ x: 0, y: 0, z: 0 })
  expect(endpoint.solvedRoutes[0]!.route.at(-1)).toEqual({ x: 0, y: 0, z: 1 })
})
