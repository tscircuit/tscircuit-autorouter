import { expect, test } from "bun:test"
import { MultipleHighDensityRouteStitchSolver3 } from "lib/solvers/RouteStitchingSolver/MultipleHighDensityRouteStitchSolver3"
import type { SimpleRouteConnection } from "lib/types"
import fixture from "./fixtures/sample24-rounded-stacked-terminals.json"

test("rounded sample24 C14.1 and C12.1 fragments select their own terminal layers before orientation", (): void => {
  for (const reversed of [false, true]) {
    const params = structuredClone(fixture)
    if (reversed) {
      params.connections[0]!.pointsToConnect.reverse()
      params.hdRoutes.reverse()
      for (const route of params.hdRoutes) {
        route.route.reverse()
        const { startPcbPortId, endPcbPortId } = route
        route.startPcbPortId = endPcbPortId
        route.endPcbPortId = startPcbPortId
      }
    }
    const solver = new MultipleHighDensityRouteStitchSolver3({
      ...params,
      connections: params.connections as SimpleRouteConnection[],
    })
    solver.solve()

    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(solver.mergedHdRoutes).toHaveLength(1)
    const route = solver.mergedHdRoutes[0]!
    const endpointsById = new Map([
      [route.startPcbPortId, route.route[0]!],
      [route.endPcbPortId, route.route.at(-1)!],
    ])
    expect(new Set(endpointsById.keys())).toEqual(new Set(["pcb_port_altium_8622", "pcb_port_altium_7312"]))
    expect(endpointsById.get("pcb_port_altium_8622")!.z).toBe(7)
    expect(endpointsById.get("pcb_port_altium_7312")!.z).toBe(0)
    expect(route.vias).toEqual([{ x: 197.724, y: 122.295 }])
  }
})
