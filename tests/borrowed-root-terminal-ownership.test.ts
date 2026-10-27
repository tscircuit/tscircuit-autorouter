import { expect, test } from "bun:test"
import type { HighDensityIntraNodeRoute } from "lib/types/high-density-types"
import { scopeBorrowedRouteTerminals } from "lib/solvers/RouteStitchingSolver/scopeBorrowedRouteTerminals"
import { SingleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/SingleHighDensityRouteStitchSolver3"

const makeRoute = (args: {
  connectionName: string
  start: { x: number; y: number; z: number }
  end: { x: number; y: number; z: number }
  startPcbPortId?: string
  endPcbPortId?: string
}): HighDensityIntraNodeRoute => ({
  connectionName: args.connectionName,
  rootConnectionName: "source_trace_1",
  traceThickness: 0.15,
  viaDiameter: 0.6,
  vias: [],
  route: [args.start, args.end],
  startPcbPortId: args.startPcbPortId,
  endPcbPortId: args.endPcbPortId,
})

test("borrowed tree copper scopes terminal roles without dropping physical geometry or masking owned errors", () => {
  const connectionName = "source_trace_1__source_net_1_mst76"
  const start = { x: -15.85, y: -12, z: 0, pcb_port_id: "pcb_port_274" }
  const end = { x: -10.6625, y: -9.75, z: 0, pcb_port_id: "pcb_port_783" }
  const junction = { x: -10, y: -12, z: 0 }
  const otherPad = { x: -6.25, y: -13.662, z: 0 }
  const owned = makeRoute({
    connectionName,
    start,
    end: junction,
    startPcbPortId: "pcb_port_274",
  })
  const borrowed = makeRoute({
    connectionName: "source_trace_1__source_net_1_mst31",
    start: junction,
    end: otherPad,
    endPcbPortId: "pcb_port_793",
  })
  const borrowedEnd = makeRoute({
    connectionName: "source_trace_1__source_net_1_mst0",
    start: otherPad,
    end,
    startPcbPortId: "pcb_port_793",
    endPcbPortId: "pcb_port_783",
  })
  const routes = [owned, borrowed, borrowedEnd]
  const geometry = routes.map((route) => route.route)
  const scoped = scopeBorrowedRouteTerminals({
    routes,
    ownedRoutes: new Set([owned]),
    terminals: [start, end],
  })
  expect(scoped[0]).toBe(owned)
  expect(scoped.map((route) => route.route)).toEqual(geometry)
  expect(borrowed.endPcbPortId).toBe("pcb_port_793")
  expect(scoped[1]!.endPcbPortId).toBeUndefined()
  expect(scoped[2]!.endPcbPortId).toBe("pcb_port_783")
  const options = {
    connectionName,
    start,
    end,
    preserveTerminalPcbPortIds: true,
    isStitchSegmentClear: (): boolean => true,
    stitchClearanceMode: "require_clear" as const,
  }
  expect(
    () =>
      new SingleHighDensityRouteStitchSolver3({ ...options, hdRoutes: routes }),
  ).toThrow('unknown PCB terminal "pcb_port_793"')
  const solver = new SingleHighDensityRouteStitchSolver3({
    ...options,
    hdRoutes: scoped,
  })
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(
    [
      solver.mergedHdRoute.startPcbPortId,
      solver.mergedHdRoute.endPcbPortId,
    ].sort(),
  ).toEqual(["pcb_port_274", "pcb_port_783"])
  const firstPoint = solver.mergedHdRoute.route[0]!
  expect(solver.mergedHdRoute.startPcbPortId).toBe(
    firstPoint.x === start.x ? "pcb_port_274" : "pcb_port_783",
  )
  expect(solver.mergedHdRoute.route).toContainEqual(otherPad)
  const invalidOwned = scopeBorrowedRouteTerminals({
    routes,
    ownedRoutes: new Set(routes),
    terminals: [start, end],
  })
  expect(
    () =>
      new SingleHighDensityRouteStitchSolver3({
        ...options,
        hdRoutes: invalidOwned,
      }),
  ).toThrow('unknown PCB terminal "pcb_port_793"')
})
