import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"

test("declared stitching starts on the owned terminal layer despite a closer XY endpoint on another layer", (): void => {
  const solver = new MultipleHighDensityRouteStitchSolver3({
    connections: [{ name: "branch", pointsToConnect: [
      { x: 10, y: 0, layer: "bottom" },
      { x: 0, y: 0, layer: "top", pcb_port_id: "A" },
    ] }],
    hdRoutes: [
      { connectionName: "branch", startPcbPortId: "A", traceThickness: 0.1, viaDiameter: 0.3,
        route: [{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }], vias: [] },
      { connectionName: "branch", traceThickness: 0.1, viaDiameter: 0.3,
        route: [{ x: 10, y: 0, z: 0 }, { x: 12, y: 0, z: 0 }, { x: 12, y: 0, z: 3 }, { x: 10, y: 0, z: 3 }],
        vias: [{ x: 12, y: 0 }] },
    ],
    layerCount: 4,
    preserveTerminalPcbPortIds: true,
    useDeclaredConnectionEndpoints: true,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const route = solver.mergedHdRoutes[0]!
  expect(route.route[0]).toMatchObject({ x: 10, y: 0, z: 3 })
  expect(route.route.at(-1)).toMatchObject({ x: 0, y: 0, z: 0 })
  expect(route.endPcbPortId).toBe("A")
  expect(route.vias).toEqual([{ x: 12, y: 0 }])
})
