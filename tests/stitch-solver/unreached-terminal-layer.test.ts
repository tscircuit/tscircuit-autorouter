import { expect, test } from "bun:test"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"

test("fails when the stitched copper cannot reach a tagged PCB terminal layer", (): void => {
  const solver = new SingleHighDensityRouteStitchSolver3({
    connectionName: "reference",
    start: { x: 0, y: 0, z: 0, pcb_port_id: "ic-pad" },
    end: { x: 1, y: 0, z: 3, pcb_port_id: "capacitor-pad" },
    preserveTerminalPcbPortIds: true,
    isStitchSegmentClear: () => true,
    stitchClearanceMode: "require_clear",
    defaultTraceThickness: 0.1,
    defaultViaDiameter: 0.3,
    hdRoutes: [
      {
        connectionName: "reference",
        traceThickness: 0.1,
        viaDiameter: 0.3,
        startPcbPortId: "ic-pad",
        route: [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
        ],
        vias: [],
      },
    ],
  })
  solver.solve()
  expect(solver.solved).toBeFalse()
  expect(solver.failed).toBeTrue()
  expect(solver.error).toContain("PCB terminal layers")
})
