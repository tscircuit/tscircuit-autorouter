import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

const makeRoute = (
  connectionName: string,
  points: HighDensityIntraNodeRoute["route"],
  terminalIds: {
    startPcbPortId?: string
    endPcbPortId?: string
  } = {},
): HighDensityIntraNodeRoute => ({
  connectionName,
  rootConnectionName: `${connectionName}_root`,
  traceThickness: 0.15,
  viaDiameter: 0.3,
  route: points,
  vias: [],
  jumpers: [],
  ...terminalIds,
})

test("multiple stitch drops a detached island beside one complete route", () => {
  const solver = new MultipleHighDensityRouteStitchSolver3({
    connections: [
      {
        name: "signal_a",
        __rootConnectionNames: ["signal_a_root"],
        pointsToConnect: [
          {
            x: 0,
            y: 0,
            layer: "top",
            pcb_port_id: "pcb_port_a_start",
          },
          {
            x: 10,
            y: 0,
            layer: "top",
            pcb_port_id: "pcb_port_a_end",
          },
        ],
      },
      {
        name: "signal_b",
        __rootConnectionNames: ["signal_b_root"],
        pointsToConnect: [
          {
            x: 0,
            y: 2,
            layer: "top",
            pcb_port_id: "pcb_port_b_start",
          },
          {
            x: 10,
            y: 2,
            layer: "top",
            pcb_port_id: "pcb_port_b_end",
          },
        ],
      },
    ],
    hdRoutes: [
      makeRoute(
        "signal_a",
        [
          { x: 0, y: 0, z: 0 },
          { x: 10, y: 0, z: 0 },
        ],
        {
          startPcbPortId: "pcb_port_a_start",
          endPcbPortId: "pcb_port_a_end",
        },
      ),
      makeRoute("signal_a", [
        { x: 0.5, y: 1.5, z: 0 },
        { x: 0.5, y: 2.5, z: 0 },
      ]),
      makeRoute(
        "signal_b",
        [
          { x: 1, y: 2, z: 0 },
          { x: 10, y: 2, z: 0 },
        ],
        {
          endPcbPortId: "pcb_port_b_end",
        },
      ),
      makeRoute("signal_b", [
        { x: 4, y: 4, z: 0 },
        { x: 5, y: 4, z: 0 },
      ]),
    ],
    colorMap: {},
    layerCount: 2,
    preserveTerminalPcbPortIds: true,
  })

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.mergedHdRoutes).toHaveLength(2)
  const signalB = solver.mergedHdRoutes.find(
    (route) => route.connectionName === "signal_b",
  )!
  expect(new Set([signalB.startPcbPortId, signalB.endPcbPortId])).toEqual(
    new Set(["pcb_port_b_start", "pcb_port_b_end"]),
  )
  expect([signalB.route[0], signalB.route.at(-1)]).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ x: 0, y: 2, z: 0 }),
      expect.objectContaining({ x: 10, y: 2, z: 0 }),
    ]),
  )
  expect(signalB.route).toContainEqual({ x: 1, y: 2, z: 0 })
})
