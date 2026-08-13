import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { SimpleRouteConnection } from "lib/types"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("a disconnected island does not snap both ends to one PCB terminal", () => {
  const connection = {
    name: "conn",
    pointsToConnect: [
      {
        x: 0,
        y: 0,
        layer: "top",
        pcb_port_id: "pcb_port_start",
      },
      {
        x: 10,
        y: 0,
        layer: "top",
        pcb_port_id: "pcb_port_end",
      },
    ],
  } as SimpleRouteConnection
  const island = {
    connectionName: "conn",
    route: [
      { x: 0, y: 0, z: 0 },
      { x: 0.5, y: 0, z: 0 },
    ],
    vias: [],
    jumpers: [],
    traceThickness: 0.15,
    viaDiameter: 0.3,
  } satisfies HighDensityIntraNodeRoute

  const solver = new MultipleHighDensityRouteStitchSolver3({
    connections: [connection],
    hdRoutes: [island],
    layerCount: 2,
    preserveTerminalPcbPortIds: true,
  })

  expect(solver.unsolvedRoutes).toHaveLength(1)
  expect(solver.unsolvedRoutes[0]!.start.pcb_port_id).toBe("pcb_port_start")
  expect(solver.unsolvedRoutes[0]!.end.pcb_port_id).toBeUndefined()
})
