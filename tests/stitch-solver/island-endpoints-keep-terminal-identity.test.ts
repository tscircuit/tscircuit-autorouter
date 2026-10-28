import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"

test("nearby PCB terminals remain distinct after island snapping", (): void => {
  const solver = new MultipleHighDensityRouteStitchSolver3({
    connections: [{
      name: "signal",
      pointsToConnect: [
        { x: 0, y: 0, layer: "top", pcb_port_id: "start" },
        { x: 1, y: 0, layer: "top", pcb_port_id: "end" },
      ],
    }],
    hdRoutes: [
      {
        connectionName: "signal",
        endPcbPortId: "end",
        traceThickness: 0.1,
        viaDiameter: 0.3,
        route: [{ x: 0.6, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }],
        vias: [],
      },
    ],
    layerCount: 2,
    preserveTerminalPcbPortIds: true,
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.mergedHdRoutes).toHaveLength(1)
  const route = solver.mergedHdRoutes[0]!
  expect({
    [route.startPcbPortId!]: route.route[0],
    [route.endPcbPortId!]: route.route.at(-1),
  }).toEqual({
    start: { x: 0, y: 0, z: 0 },
    end: { x: 1, y: 0, z: 0 },
  })
})
