import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"

type RouteFixture = {
  startX: number
  endX: number
  startPcbPortId?: string
  endPcbPortId?: string
}

const createRoute = ({
  startX,
  endX,
  startPcbPortId,
  endPcbPortId,
}: RouteFixture): HighDensityIntraNodeRoute => ({
  connectionName: "power_mst0",
  rootConnectionName: "power",
  traceThickness: 0.15,
  viaDiameter: 0.3,
  route: [
    { x: startX, y: 0, z: 0 },
    { x: endX, y: 0, z: 0 },
  ],
  vias: [],
  ...(startPcbPortId ? { startPcbPortId } : {}),
  ...(endPcbPortId ? { endPcbPortId } : {}),
})

const connections = [
  {
    name: "power_mst0",
    __rootConnectionNames: ["power"],
    pointsToConnect: [
      { x: 0, y: 0, layer: "top" as const, pcb_port_id: "pcb_port_a" },
      { x: 20, y: 0, layer: "top" as const, pcb_port_id: "pcb_port_c" },
    ],
  },
  {
    name: "power",
    pointsToConnect: [
      { x: 0, y: 0, layer: "top" as const, pcb_port_id: "pcb_port_a" },
      { x: 10, y: 0, layer: "top" as const, pcb_port_id: "pcb_port_b" },
      { x: 20, y: 0, layer: "top" as const, pcb_port_id: "pcb_port_c" },
      { x: 30, y: 0, layer: "top" as const, pcb_port_id: "pcb_port_d" },
    ],
  },
  {
    name: "signal_mst0",
    __rootConnectionNames: ["signal"],
    pointsToConnect: [
      {
        x: 0,
        y: 10,
        layer: "top" as const,
        pcb_port_id: "pcb_port_foreign",
      },
      { x: 20, y: 10, layer: "top" as const, pcb_port_id: "pcb_port_e" },
    ],
  },
]

test("same-root sibling terminals are internal while cross-net terminals still fail", () => {
  const solver = new MultipleHighDensityRouteStitchSolver3({
    connections,
    hdRoutes: [
      createRoute({
        startX: 0,
        endX: 10,
        startPcbPortId: "pcb_port_a",
        endPcbPortId: "pcb_port_b",
      }),
      createRoute({
        startX: 10,
        endX: 20,
        startPcbPortId: "pcb_port_b",
        endPcbPortId: "pcb_port_c",
      }),
    ],
    layerCount: 2,
    preserveTerminalPcbPortIds: true,
  })

  solver.solve()

  expect(solver.failed).toBe(false)
  expect(solver.mergedHdRoutes).toHaveLength(1)
  expect(solver.mergedHdRoutes[0]).toMatchObject({
    connectionName: "power_mst0",
    startPcbPortId: "pcb_port_a",
    endPcbPortId: "pcb_port_c",
  })

  expect(
    () => {
      const solverWithUnknownTerminal =
        new MultipleHighDensityRouteStitchSolver3({
          connections,
          hdRoutes: [
            createRoute({
              startX: 0,
              endX: 20,
              startPcbPortId: "pcb_port_a",
              endPcbPortId: "pcb_port_foreign",
            }),
          ],
          layerCount: 2,
          preserveTerminalPcbPortIds: true,
        })
      solverWithUnknownTerminal.solve()
    },
  ).toThrow('found unknown PCB terminal "pcb_port_foreign"')
})
