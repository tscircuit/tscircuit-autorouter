import { expect, test } from "bun:test"
import { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"

test("a hard minimum without a nominal width also applies to terminal copper", (): void => {
  const solver = new TraceWidthSolver({
    hdRoutes: [{ connectionName: "POWER", traceThickness: 0.4, viaDiameter: 0.3, vias: [],
      route: [{ x: -2, y: 0, z: 0 }, { x: 2, y: 0, z: 0 }] }],
    connection: [{ name: "POWER", minTraceWidth: 0.4, pointsToConnect: [] }],
    minTraceWidth: 0.1, layerCount: 1,
    obstacles: [-2, 2].map((x) => ({ type: "rect" as const, layers: ["top"], center: { x, y: 0 }, width: 0.2, height: 0.2, connectedTo: ["POWER"] })),
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  const route = solver.getHdRoutesWithWidths()[0]!
  expect(route.traceThickness).toBe(0.4)
  expect(route.route.every((point) => point.traceThickness === 0.4)).toBe(true)
})
