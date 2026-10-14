import { expect, test } from "bun:test"
import { getSvgFromGraphicsObject } from "graphics-debug"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"

const pmp22650NearCoincidentTerminalRoute = {
  connectionName: "source_net_altium_pcb_3_mst0",
  start: {
    x: 197.98394489999998,
    y: 123.16207269999998,
    z: 7,
    pcb_port_id: "pcb_port_altium_8622",
  },
  end: {
    x: 197.98440972,
    y: 123.16207269999998,
    z: 0,
    pcb_port_id: "pcb_port_altium_7312",
  },
  hdRoutes: [
    {
      connectionName: "source_net_altium_pcb_3_mst0",
      startPcbPortId: "pcb_port_altium_7312",
      route: [
        { x: 197.98440972, y: 123.16207269999998, z: 0 },
        { x: 198.03440972, y: 123.16207269999998, z: 0 },
      ],
      vias: [],
      jumpers: [],
      viaDiameter: 0.3,
      traceThickness: 0.1,
    },
  ],
  isStitchSegmentClear: () => true,
  stitchClearanceMode: "require_clear" as const,
}

test("PMP22650 near-coincident multilayer terminals use PCB terminal identity", () => {
  expect(
    () =>
      new SingleHighDensityRouteStitchSolver3({
        ...pmp22650NearCoincidentTerminalRoute,
        preserveTerminalPcbPortIds: false,
      }),
  ).not.toThrow()

  const solver = new SingleHighDensityRouteStitchSolver3({
    ...pmp22650NearCoincidentTerminalRoute,
    preserveTerminalPcbPortIds: true,
  })

  expect(solver.start.pcb_port_id).toBe("pcb_port_altium_7312")
  expect(solver.end.pcb_port_id).toBe("pcb_port_altium_8622")
  expect(getSvgFromGraphicsObject(solver.visualize())).toMatchSvgSnapshot(
    import.meta.path,
  )
})
