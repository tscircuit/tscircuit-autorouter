import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("an unclaimed partial island boundary does not impersonate a nearby opposite-layer SMT terminal", (): void => {
  const route: HighDensityIntraNodeRoute = {
    connectionName: "partial-net",
    startPcbPortId: "start-port",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0, y: 0, z: 1 },
      { x: 1, y: 0, z: 1 },
      { x: 1, y: 0, z: 0 },
      { x: 2.4, y: 0, z: 0 },
    ],
    vias: [{ x: 1, y: 0 }],
  }
  const inputSnapshot = structuredClone(route)
  const solver = new MultipleHighDensityRouteStitchSolver3({
    connections: [
      {
        name: route.connectionName,
        pointsToConnect: [
          { x: 0, y: 0, layer: "bottom", pcb_port_id: "start-port" },
          { x: 3, y: 0, layer: "bottom", pcb_port_id: "end-port" },
        ],
      },
    ],
    hdRoutes: [route],
    layerCount: 2,
    preserveTerminalPcbPortIds: true,
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.mergedHdRoutes).toHaveLength(1)
  const merged = solver.mergedHdRoutes[0]!
  expect([merged.route[0], merged.route[merged.route.length - 1]]).toEqual(
    expect.arrayContaining([
      { x: 0, y: 0, z: 1 },
      { x: 2.4, y: 0, z: 0 },
    ]),
  )
  expect(
    [merged.startPcbPortId, merged.endPcbPortId].filter(Boolean),
  ).toEqual(["start-port"])
  expect(merged.vias).toEqual(route.vias)
  expect(merged.route).toHaveLength(route.route.length)
  expect(
    merged.route.some((point): boolean => point.x === 3 && point.z === 1),
  ).toBe(false)
  expect(route).toEqual(inputSnapshot)
})
