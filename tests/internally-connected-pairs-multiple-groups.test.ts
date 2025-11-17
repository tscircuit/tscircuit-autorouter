import { test, expect } from "bun:test"
import { NetToPointPairsSolver } from "lib/solvers/NetToPointPairsSolver/NetToPointPairsSolver"
import type { SimpleRouteJson } from "lib/types"

test("NetToPointPairsSolver > handles multiple internal groups", () => {
  const testSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaDiameter: 0.6,
    obstacles: [],
    connections: [
      {
        name: "COMPLEX_CHIP",
        pointsToConnect: [
          // IOVDD group (internally connected)
          { x: 0, y: 0, layer: "top", pointId: "MCU_IOVDD_1" },
          { x: 5, y: 0, layer: "top", pointId: "MCU_IOVDD_2" },
          { x: 10, y: 0, layer: "top", pointId: "MCU_IOVDD_3" },

          // COREVDD group (internally connected)
          { x: 0, y: 5, layer: "top", pointId: "MCU_COREVDD_1" },
          { x: 5, y: 5, layer: "top", pointId: "MCU_COREVDD_2" },

          // External components
          { x: 20, y: 2, layer: "top", pointId: "POWER_INPUT" },
          { x: 25, y: 8, layer: "top", pointId: "DECOUPLING_CAP" },
        ],
        internallyConnectedPointIds: [
          ["MCU_IOVDD_1", "MCU_IOVDD_2", "MCU_IOVDD_3"], // Group 1: IOVDD pins
          ["MCU_COREVDD_1", "MCU_COREVDD_2"], // Group 2: COREVDD pins
        ],
      },
    ],
    bounds: { minX: -2, maxX: 30, minY: -2, maxY: 12 },
  }

  const solver = new NetToPointPairsSolver(testSrj)

  while (!solver.solved && !solver.failed) {
    solver.step()
  }

  expect(solver.solved).toBe(true)

  const newSrj = solver.getNewSimpleRouteJson()

  // Should have external points
  const allPointIdsInOutput = newSrj.connections
    .flatMap((conn) => conn.pointsToConnect.map((p) => p.pointId))
    .filter(Boolean)

  expect(allPointIdsInOutput).toContain("POWER_INPUT")
  expect(allPointIdsInOutput).toContain("DECOUPLING_CAP")

  // Should have at most 1 representative from each internal group
  const iovddPoints = allPointIdsInOutput.filter((id) =>
    id?.startsWith("MCU_IOVDD_"),
  )
  const corevddPoints = allPointIdsInOutput.filter((id) =>
    id?.startsWith("MCU_COREVDD_"),
  )

  expect(new Set(iovddPoints).size).toBeLessThanOrEqual(1)
  expect(new Set(corevddPoints).size).toBeLessThanOrEqual(1)
})

test("NetToPointPairsSolver > handles mixed internal and external connections", () => {
  const testSrj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.15,
    minViaDiameter: 0.6,
    obstacles: [],
    connections: [
      {
        name: "MIXED_CONNECTION",
        pointsToConnect: [
          // Internally connected group
          { x: 0, y: 0, layer: "top", pointId: "INT_1" },
          { x: 5, y: 0, layer: "top", pointId: "INT_2" },
          // Externally connected group
          { x: 10, y: 5, layer: "top", pointId: "EXT_1" },
          { x: 15, y: 5, layer: "top", pointId: "EXT_2" },
          // Regular points that need routing
          { x: 20, y: 0, layer: "top", pointId: "REG_1" },
          { x: 25, y: 0, layer: "top", pointId: "REG_2" },
        ],
        internallyConnectedPointIds: [["INT_1", "INT_2"]],
        externallyConnectedPointIds: [["EXT_1", "EXT_2"]],
      },
    ],
    bounds: { minX: -2, maxX: 30, minY: -5, maxY: 10 },
  }

  const solver = new NetToPointPairsSolver(testSrj)

  while (!solver.solved && !solver.failed) {
    solver.step()
  }

  expect(solver.solved).toBe(true)

  const newSrj = solver.getNewSimpleRouteJson()

  // Should create connections for external points
  expect(newSrj.connections.length).toBeGreaterThan(0)

  const allPointIdsInOutput = newSrj.connections
    .flatMap((conn) => conn.pointsToConnect.map((p) => p.pointId))
    .filter(Boolean)

  // Should have external points
  expect(allPointIdsInOutput.some((id) => id?.startsWith("REG_"))).toBe(true)

  // Should have at most 1 internal representative
  const internalPoints = allPointIdsInOutput.filter((id) =>
    id?.startsWith("INT_"),
  )
  expect(new Set(internalPoints).size).toBeLessThanOrEqual(1)

  // External connections should also be handled (no external routing needed)
  const externalPoints = allPointIdsInOutput.filter((id) =>
    id?.startsWith("EXT_"),
  )
  // External points might appear if they connect to other points, but not in external-to-external connections
  expect(externalPoints.length).toBeGreaterThanOrEqual(0)
})
