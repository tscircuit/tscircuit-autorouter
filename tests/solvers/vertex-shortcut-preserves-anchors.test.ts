import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { VertexShortcutPathSolver } from "lib/solvers/SimplifiedPathSolver/VertexShortcutPathSolver"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("vertex shortcuts preserve terminals, vias, widths and jumper anchors", () => {
  const inputRoute: HighDensityRoute = {
    connectionName: "signal",
    traceThickness: 0.15,
    viaDiameter: 0.4,
    vias: [{ x: 4, y: 0 }],
    jumpers: [
      {
        route_type: "jumper",
        start: { x: 9, y: 0 },
        end: { x: 10, y: 0 },
        footprint: "0603",
      },
    ],
    route: [
      { x: 0, y: 0, z: 0, pcb_port_id: "start" },
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0, pcb_port_id: "tap" },
      { x: 3, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
      { x: 4, y: 0, z: 1 },
      { x: 5, y: 0, z: 1, toNextSegmentType: "through_obstacle" },
      { x: 5, y: 0, z: 0 },
      { x: 6, y: 0, z: 0, traceThickness: 0.3 },
      { x: 7, y: 0, z: 0, traceThickness: 0.3 },
      { x: 8, y: 0, z: 0, traceThickness: 0.3 },
      { x: 9, y: 0, z: 0, insideJumperPad: true },
      { x: 10, y: 0, z: 0, insideJumperPad: true },
      { x: 11, y: 0, z: 0, pcb_port_id: "end" },
    ],
  }
  const original = structuredClone(inputRoute)
  const solver = new VertexShortcutPathSolver({
    inputRoute,
    otherHdRoutes: [],
    obstacles: [],
    connMap: new ConnectivityMap({}),
    colorMap: {},
    useTraceWidthAwareClearance: true,
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const output = solver.simplifiedRoute
  expect(output.route).toEqual(
    inputRoute.route.filter((_, index) => index !== 1 && index !== 3),
  )
  expect(output.vias).toEqual(inputRoute.vias)
  expect(output.jumpers).toEqual(inputRoute.jumpers)
  expect(inputRoute).toEqual(original)
})
