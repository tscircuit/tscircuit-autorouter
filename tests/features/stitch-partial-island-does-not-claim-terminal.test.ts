import { expect, test } from "bun:test"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"

test("a partial stitched island does not claim a disconnected PCB terminal", () => {
  const solver = new SingleHighDensityRouteStitchSolver3({
    connectionName: "net-mst0",
    start: { x: 0, y: 0, z: 0, pcb_port_id: "pad-a" },
    end: { x: 10, y: 0, z: 0, pcb_port_id: "pad-b" },
    preserveTerminalPcbPortIds: true,
    enableCompleteTerminalStitching: true,
    isStitchSegmentClear: () => true,
    stitchClearanceMode: "require_clear",
    hdRoutes: [
      {
        connectionName: "net-mst0",
        rootConnectionName: "net",
        startPcbPortId: "pad-a",
        traceThickness: 0.1524,
        viaDiameter: 0.2032,
        vias: [],
        route: [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
        ],
      },
      {
        connectionName: "net-mst0",
        rootConnectionName: "net",
        endPcbPortId: "pad-b",
        traceThickness: 0.1524,
        viaDiameter: 0.2032,
        vias: [],
        route: [
          { x: 5, y: 0, z: 0 },
          { x: 10, y: 0, z: 0 },
        ],
      },
    ],
  })
  solver.solve()
  expect(solver.solved).toBeTrue()
  expect(solver.mergedHdRoute.route.at(-1)).toEqual({ x: 1, y: 0, z: 0 })
  expect(solver.mergedHdRoute.startPcbPortId).toBe("pad-a")
  expect(solver.mergedHdRoute.endPcbPortId).toBeUndefined()
  expect(solver.unmergedHdRoutes).toHaveLength(1)
  expect(solver.unmergedHdRoutes[0]!.endPcbPortId).toBe("pad-b")
})
