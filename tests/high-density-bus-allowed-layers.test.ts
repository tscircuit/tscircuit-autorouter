import { expect, test } from "bun:test"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"

test("detailed routing honors sparse allowed layers when both terminals are on top", () => {
  const solver = new IntraNodeRouteSolver({
    nodeWithPortPoints: {
      capacityMeshNodeId: "node", center: { x: 0, y: 0 }, width: 6, height: 4,
      availableZ: [0, 1, 2, 3],
      allowedZByConnection: { signal: [0, 3] },
      portPoints: [
        { connectionName: "signal", x: -2, y: 0, z: 0 },
        { connectionName: "signal", x: 2, y: 0, z: 0 },
      ],
    },
    layerCount: 4,
  })
  solver.solvedRoutes = [{
    connectionName: "barrier", traceThickness: 0.2, viaDiameter: 0.3,
    route: [{ x: 0, y: -2, z: 0 }, { x: 0, y: 2, z: 0 }], vias: [],
  }]
  solver.solve()
  expect(solver.solved).toBe(true)
  const signal = solver.solvedRoutes.find((route) => route.connectionName === "signal")!
  expect([...new Set(signal.route.map((point) => point.z))].sort()).toEqual([0, 3])
})
