import { test, expect } from "bun:test"
import { NetToPointPairsSolver } from "lib/solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import type { SimpleRouteJson } from "lib/types"

test("NetToPointPairsSolver > handles internally connected RP2040 IOVDD pins", () => {
  const testSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaDiameter: 0.6,
    obstacles: [],
    connections: [
      {
        name: "IOVDD_POWER",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pointId: "RP2040_IOVDD_1" },
          { x: 5, y: 0, layer: "top", pointId: "RP2040_IOVDD_2" },
          { x: 10, y: 0, layer: "top", pointId: "RP2040_IOVDD_3" },
          { x: 15, y: 0, layer: "top", pointId: "RP2040_IOVDD_4" },
          // External component that needs connection
          { x: 20, y: 10, layer: "top", pointId: "EXTERNAL_CAP" },
        ],
        internallyConnectedPointIds: [
          [
            "RP2040_IOVDD_1",
            "RP2040_IOVDD_2",
            "RP2040_IOVDD_3",
            "RP2040_IOVDD_4",
          ],
        ],
      },
    ],
    bounds: { minX: -2, maxX: 25, minY: -5, maxY: 15 },
  }

  const solver = new NetToPointPairsSolver(testSrj)

  // Run the solver
  while (!solver.solved && !solver.failed) {
    solver.step()
  }

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)

  const newSrj = solver.getNewSimpleRouteJson()

  // Should create connections, but only one representative from internal group
  expect(newSrj.connections.length).toBeGreaterThan(0)

  // Get all point IDs from output connections
  const allPointIdsInOutput = newSrj.connections
    .flatMap((conn) => conn.pointsToConnect.map((p) => p.pointId))
    .filter(Boolean)

  // Should have external point
  expect(allPointIdsInOutput).toContain("EXTERNAL_CAP")

  // Should have at most 1 representative from internal group
  const internalPointIds = allPointIdsInOutput.filter((id) =>
    id?.startsWith("RP2040_IOVDD_"),
  )
  const uniqueInternalIds = new Set(internalPointIds)
  expect(uniqueInternalIds.size).toBeLessThanOrEqual(1)

  // Should not create connections between internal points
  newSrj.connections.forEach((conn) => {
    const internalPointsInConn = conn.pointsToConnect.filter((p) =>
      p.pointId?.startsWith("RP2040_IOVDD_"),
    )
    // Each connection should have at most 1 internal point
    expect(internalPointsInConn.length).toBeLessThanOrEqual(1)
  })
})

test("NetToPointPairsSolver > handles case with only internally connected points", () => {
  const testSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaDiameter: 0.6,
    obstacles: [],
    connections: [
      {
        name: "ALL_INTERNAL",
        pointsToConnect: [
          { x: 0, y: 0, layer: "top", pointId: "INT_1" },
          { x: 5, y: 0, layer: "top", pointId: "INT_2" },
          { x: 10, y: 0, layer: "top", pointId: "INT_3" },
        ],
        internallyConnectedPointIds: [
          ["INT_1", "INT_2", "INT_3"], // All points are internal
        ],
      },
    ],
    bounds: { minX: -2, maxX: 15, minY: -5, maxY: 5 },
  }

  const solver = new NetToPointPairsSolver(testSrj)

  while (!solver.solved && !solver.failed) {
    solver.step()
  }

  expect(solver.solved).toBe(true)

  const newSrj = solver.getNewSimpleRouteJson()

  // Should create no connections since all points are internally connected
  expect(newSrj.connections.length).toBe(0)
})
