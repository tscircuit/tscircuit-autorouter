import { expect, test } from "bun:test"
import { ResizedHighDensityGridSolver } from "lib/solvers/HighDensitySolver/ResizedHighDensityGridSolver"

test("incompatible fixed terminals fail before a resized grid is allocated", (): void => {
  const solver = new ResizedHighDensityGridSolver({
    nodeWithPortPoints: {
      capacityMeshNodeId: "crowded-resized-node",
      center: { x: 0, y: 0 },
      width: 200,
      height: 200,
      availableZ: [0, 1],
      portPoints: [
        { x: -100, y: 0, z: 0, connectionName: "a" },
        { x: 100, y: 0, z: 0, connectionName: "a" },
        { x: -100, y: 0.2, z: 0, connectionName: "b" },
        { x: 100, y: 10, z: 0, connectionName: "b" },
      ],
    },
    coordinateScale: 32,
    maxSearchIterations: 100_000,
    traceWidth: 0.127,
    viaDiameter: 0.3,
    traceMargin: 0.1,
    effort: 1,
    shuffleSeed: 0,
  })
  solver.step()
  expect(solver.solved).toBeFalse()
  expect(solver.failed).toBeTrue()
  expect(solver.error).toContain("terminals violate")
  expect(solver.gridStats.states).toBe(0)
  expect(solver.solvedConnectionsMap.size).toBe(0)
})
