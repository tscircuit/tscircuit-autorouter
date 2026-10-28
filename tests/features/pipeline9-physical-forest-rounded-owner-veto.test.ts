import { expect, test } from "bun:test"
import { PhysicalNetForestSolver } from "lib/solvers/PhysicalNetForestSolver/PhysicalNetForestSolver"
import type { SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"

test("a rounded foreign owner cannot certify blocked forest copper or connectivity", () => {
  const originalSrj: SimpleRouteJson = {
    layerCount: 2, minTraceWidth: 0.1,
    bounds: { minX: -5, maxX: 5, minY: -5, maxY: 5 },
    connections: [
      { name: "signal", pointsToConnect: [
        { x: 0, y: 0, layer: "top", pointId: "signal-a", pcb_port_id: "signal-a" },
        { x: 2, y: 0, layer: "top", pointId: "signal-b", pcb_port_id: "signal-b" },
        { x: 2, y: 2, layer: "top", pointId: "signal-c", pcb_port_id: "signal-c" },
      ] },
      { name: "ground", pointsToConnect: [{ x: 0.004, y: 0, layer: "top", pointId: "ground-a", pcb_port_id: "ground-a" }] },
    ],
    obstacles: [{ type: "rect", center: { x: 0.004, y: 0 }, width: 0.4, height: 0.4, layers: ["top"], connectedTo: ["ground"] }],
  }
  expect(getConnectivityMapFromSimpleRouteJson(originalSrj).areIdsConnected("signal", "ground")).toBeTrue()
  const blocked = new PhysicalNetForestSolver(originalSrj)
  blocked.solve()
  expect(blocked.branches).toEqual([])
  expect(blocked.diagnostics.rejectedVisibility).toBe(1)

  const clear = new PhysicalNetForestSolver({ ...originalSrj, obstacles: [] })
  clear.solve()
  expect(clear.branches).toHaveLength(2)
  clear.assertOutputPhysicalConnectivity(clear.branches)
  const foreignTrace: SimplifiedPcbTrace = {
    type: "pcb_trace", pcb_trace_id: "foreign-copper", connection_name: "ground",
    route: [
      { route_type: "wire", x: 0, y: 0, width: 0.1, layer: "top" },
      { route_type: "wire", x: 2, y: 0, width: 0.1, layer: "top" },
      { route_type: "wire", x: 2, y: 2, width: 0.1, layer: "top" },
    ],
  }
  expect(() => clear.assertOutputPhysicalConnectivity([foreignTrace])).toThrow("Physical forest lost copper connectivity")
})
