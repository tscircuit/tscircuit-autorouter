import { expect, test } from "bun:test"
import { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"
import type { TraceWidthSolverInput } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"

test("assigning a hard minimum for geometry repair still requires final clearance validation", (): void => {
  const input: TraceWidthSolverInput = {
    hdRoutes: [
      {
        connectionName: "POWER",
        traceThickness: 0.1,
        viaDiameter: 0.3,
        route: [
          { x: -1, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
        ],
        vias: [],
      },
    ],
    connection: [{ name: "POWER", minTraceWidth: 0.4, pointsToConnect: [] }],
    obstacles: [
      {
        type: "rect",
        layers: ["top"],
        center: { x: 0, y: 0.5 },
        width: 1,
        height: 0.4,
        connectedTo: ["OTHER"],
      },
    ],
    minTraceWidth: 0.1,
    obstacleMargin: 0.15,
    layerCount: 1,
    deferMinimumClearanceValidation: true,
  }
  const solver = new TraceWidthSolver(input)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.getHdRoutesWithWidths()[0].traceThickness).toBe(0.4)
  expect(solver.getMinimumClearanceViolation()).toContain("POWER")
  const repaired = solver.getHdRoutesWithWidths().map((route) => ({
    ...route,
    route: route.route.map((point) => ({ ...point, y: -0.1 })),
  }))
  const validator = new TraceWidthSolver({ ...input, hdRoutes: repaired })
  expect(validator.getMinimumClearanceViolation()).toBeNull()
  const strict = new TraceWidthSolver({
    ...input,
    deferMinimumClearanceValidation: false,
  })
  strict.solve()
  expect(strict.failed).toBe(true)
})
