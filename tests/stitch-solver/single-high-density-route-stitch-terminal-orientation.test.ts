import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

test("single stitch uses preserved terminal IDs when geometry suggests the opposite orientation", async () => {
  const route: HighDensityIntraNodeRoute = {
    connectionName: "conn",
    startPcbPortId: "pcb_port_start",
    endPcbPortId: "pcb_port_end",
    traceThickness: 0.15,
    viaDiameter: 0.3,
    route: [
      { x: 0.6, y: 0, z: 0 },
      { x: 0.4, y: 0, z: 0 },
    ],
    vias: [],
    jumpers: [],
  }
  const solver = new SingleHighDensityRouteStitchSolver3({
    connectionName: "conn",
    start: { x: 0, y: 0, z: 0, pcb_port_id: "pcb_port_start" },
    end: { x: 1, y: 0, z: 0, pcb_port_id: "pcb_port_end" },
    hdRoutes: [route],
    preserveTerminalPcbPortIds: true,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.mergedHdRoute.startPcbPortId).toBe("pcb_port_end")
  expect(solver.mergedHdRoute.endPcbPortId).toBe("pcb_port_start")
  expect(solver.mergedHdRoute.route).toEqual([
    { x: 1, y: 0, z: 0 },
    { x: 0.4, y: 0, z: 0 },
    { x: 0.6, y: 0, z: 0 },
    { x: 0, y: 0, z: 0 },
  ])

  const svg = getSvgFromGraphicsObject(solver.visualize(), {
    backgroundColor: "white",
  })
  await expect(svg).toMatchSvgSnapshot(import.meta.path)
})
