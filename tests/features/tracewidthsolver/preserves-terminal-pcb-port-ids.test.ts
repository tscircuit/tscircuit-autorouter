import { expect, test } from "bun:test"
import { TraceWidthSolver } from "lib/solvers/TraceWidthSolver/TraceWidthSolver"

test("TraceWidthSolver preserves terminal PCB port identities", (): void => {
  const solver = new TraceWidthSolver({
    hdRoutes: [
      {
        connectionName: "signal",
        startPcbPortId: "pcb_port_start",
        endPcbPortId: "pcb_port_end",
        traceThickness: 0.1,
        viaDiameter: 0.45,
        vias: [],
        route: [
          { x: 0, y: 0, z: 0 },
          { x: 1, y: 0, z: 0 },
        ],
      },
    ],
    minTraceWidth: 0.1,
    obstacleMargin: 0.1,
    layerCount: 2,
    connection: [
      {
        name: "signal",
        nominalTraceWidth: 0.15,
        pointsToConnect: [],
      },
    ],
  })

  solver.solve()

  expect(solver.getHdRoutesWithWidths()[0]).toMatchObject({
    startPcbPortId: "pcb_port_start",
    endPcbPortId: "pcb_port_end",
  })
})
