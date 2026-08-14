import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import type { SimpleRouteConnection } from "lib/types/srj-types"

const makeRoute = ({
  connectionName,
  rootConnectionName,
  start,
  end,
  startPcbPortId,
  endPcbPortId,
}: {
  connectionName: string
  rootConnectionName: string
  start: { x: number; y: number; z: number }
  end: { x: number; y: number; z: number }
  startPcbPortId?: string
  endPcbPortId?: string
}): HighDensityIntraNodeRoute => ({
  connectionName,
  rootConnectionName,
  route: [start, end],
  vias: [],
  jumpers: [],
  traceThickness: 0.15,
  viaDiameter: 0.3,
  startPcbPortId,
  endPcbPortId,
})

test("shared-root path search rejects a bridge tagged with a third PCB terminal", () => {
  const connections: SimpleRouteConnection[] = [
    {
      name: "target",
      __rootConnectionNames: ["root"],
      pointsToConnect: [
        { x: 0, y: 0, layer: "top", pcb_port_id: "pcb_port_a" },
        { x: 10, y: 0, layer: "top", pcb_port_id: "pcb_port_b" },
      ],
    },
    {
      name: "branch",
      __rootConnectionNames: ["root"],
      pointsToConnect: [
        { x: 4.6, y: 0, layer: "top", pcb_port_id: "pcb_port_a" },
        { x: 5.4, y: 0, layer: "top", pcb_port_id: "pcb_port_c" },
      ],
    },
  ]
  const hdRoutes = [
    makeRoute({
      connectionName: "target",
      rootConnectionName: "root",
      start: { x: 0, y: 0, z: 0 },
      end: { x: 4.6, y: 0, z: 0 },
      startPcbPortId: "pcb_port_a",
    }),
    makeRoute({
      connectionName: "target",
      rootConnectionName: "root",
      start: { x: 5.4, y: 0, z: 0 },
      end: { x: 10, y: 0, z: 0 },
      endPcbPortId: "pcb_port_b",
    }),
    makeRoute({
      connectionName: "branch",
      rootConnectionName: "root",
      start: { x: 4.6, y: 0, z: 0 },
      end: { x: 5.4, y: 0, z: 0 },
      endPcbPortId: "pcb_port_c",
    }),
  ]

  const solver = new MultipleHighDensityRouteStitchSolver3({
    connections,
    hdRoutes,
    layerCount: 2,
    preserveTerminalPcbPortIds: true,
  })

  solver.solve()

  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  const target = solver.mergedHdRoutes.find(
    (route) => route.connectionName === "target",
  )
  expect(target?.startPcbPortId).toBe("pcb_port_a")
  expect(target?.endPcbPortId).toBe("pcb_port_b")
  expect(target?.route.some((point) => point.x === 5.4)).toBe(true)
})
