import { expect, test } from "bun:test"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"

test("an explicit plated-terminal endpoint keeps its declared alternative layer during initial route selection", (): void => {
  const solver = new SingleHighDensityRouteStitchSolver3({
    connectionName: "signal",
    start: {
      x: 0,
      y: 0,
      z: 0,
      layers: ["top", "bottom"],
      pcb_port_id: "plated",
    },
    end: { x: 0.1, y: 0, z: 0, pcb_port_id: "surface" },
    layerCount: 8,
    preserveTerminalPcbPortIds: true,
    preferSameLayerTerminalEndpoints: true,
    isStitchSegmentClear: () => true,
    stitchClearanceMode: "require_clear",
    hdRoutes: [
      {
        connectionName: "signal",
        startPcbPortId: "plated",
        endPcbPortId: "surface",
        traceThickness: 0.1,
        viaDiameter: 0.3,
        route: [
          { x: 0, y: 0, z: 7 },
          { x: 2, y: 0, z: 7 },
          { x: 2, y: 0, z: 0 },
          { x: 0.1, y: 0, z: 0 },
        ],
        vias: [{ x: 2, y: 0 }],
      },
    ],
  })
  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.mergedHdRoute.startPcbPortId).toBe("plated")
  expect(solver.mergedHdRoute.endPcbPortId).toBe("surface")
  expect(solver.start.z).toBe(7)
  expect(solver.mergedHdRoute.route[0]!.z).toBe(7)
  expect(solver.mergedHdRoute.route.at(-1)!.z).toBe(0)
  expect(solver.mergedHdRoute.vias).toEqual([{ x: 2, y: 0 }])
})
