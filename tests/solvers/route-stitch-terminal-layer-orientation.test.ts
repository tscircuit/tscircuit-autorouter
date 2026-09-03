import { expect, test } from "bun:test"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"

test("stitching orients a coincident via fragment by its terminal layers", (): void => {
  const solver = new SingleHighDensityRouteStitchSolver3({
    connectionName: "signal",
    start: { x: -0.2, y: 0, z: 1, pcb_port_id: "bottom_terminal" },
    end: { x: -0.8, y: 0.2, z: 0, pcb_port_id: "top_terminal" },
    hdRoutes: [
      {
        connectionName: "signal",
        traceThickness: 0.15,
        viaDiameter: 0.3,
        route: [
          { x: 0, y: 0, z: 0 },
          { x: 0, y: 0, z: 1 },
        ],
        vias: [{ x: 0, y: 0 }],
      },
    ],
    preserveTerminalPcbPortIds: true,
    isStitchSegmentClear: (): boolean => true,
    stitchClearanceMode: "require_clear",
  })
  solver.solve()

  expect(solver.failed).toBeFalse()
  expect(solver.solved).toBeTrue()
  const output = solver.mergedHdRoute
  const expectedLayerByPortId = new Map([
    ["bottom_terminal", 1],
    ["top_terminal", 0],
  ])
  expect(output.route[0]!.z).toBe(
    expectedLayerByPortId.get(output.startPcbPortId!)!,
  )
  expect(output.route.at(-1)!.z).toBe(
    expectedLayerByPortId.get(output.endPcbPortId!)!,
  )
  expect(output.vias).toHaveLength(1)
})
