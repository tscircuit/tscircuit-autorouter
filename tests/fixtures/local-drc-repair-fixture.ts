import type { SimpleRouteJson, SimplifiedPcbTrace, SimplifiedPcbTraces } from "lib/types"
import type { LocalDrcRepairInput } from "lib/solvers/LocalDrcRepairSolver/LocalDrcRepairSolver"

export const localWire = (x: number, y: number, layer = "top"): Extract<SimplifiedPcbTrace["route"][number], { route_type: "wire" }> => ({ route_type: "wire", x, y, layer, width: 0.1 })

export const createLocalDrcRepairFixture = (): LocalDrcRepairInput => {
  const viaRoute = (id: string, net: string, x: number, y: number): SimplifiedPcbTrace => ({
    type: "pcb_trace", pcb_trace_id: id, connection_name: net,
    route: [localWire(-2, y), localWire(x, y), { route_type: "via", x, y, from_layer: "top", to_layer: "bottom" }, localWire(x, y, "bottom"), localWire(2, y, "bottom")],
  })
  const traces: SimplifiedPcbTraces = [
    viaRoute("shared_a", "shared", 0, 0),
    viaRoute("shared_b", "shared", 0.02, 0),
    viaRoute("foreign_via", "foreign", 0, 4),
    { type: "pcb_trace", pcb_trace_id: "signal", connection_name: "signal", route: [-2, -0.5, 0.5, 2].map((x) => localWire(x, 4.29)) },
    { type: "pcb_trace", pcb_trace_id: "cross_a", connection_name: "cross_a", route: [localWire(5, 1), localWire(7, 1)] },
    { type: "pcb_trace", pcb_trace_id: "cross_b", connection_name: "cross_b", route: [localWire(6, 0), localWire(6, 2)] },
  ]
  const srj: SimpleRouteJson = {
    layerCount: 2, minTraceWidth: 0.1, minViaDiameter: 0.3, minViaHoleDiameter: 0.15,
    minTraceToPadEdgeClearance: 0.1, minViaHoleEdgeToViaHoleEdgeClearance: 0.1,
    minBoardEdgeClearance: 0.1,
    bounds: { minX: -4, minY: -3, maxX: 9, maxY: 7 },
    obstacles: [],
    connections: [...new Set(traces.map((t) => t.connection_name))].map((name) => ({
      name,
      pointsToConnect: traces.filter((t) => t.connection_name === name).flatMap((t) => [t.route[0]!, t.route.at(-1)!]).map((p) => {
        if (p.route_type !== "wire") throw new Error("Fixture terminal must be a wire")
        return { x: p.x, y: p.y, layer: p.layer }
      }),
    })),
  }
  for (const [ci, connection] of srj.connections.entries()) {
    for (const [pi, point] of connection.pointsToConnect.entries()) {
      const port = `pcb_port_${ci}_${pi}`
      point.pcb_port_id = port
      srj.obstacles.push({ type: "rect", center: { x: point.x, y: point.y }, width: 0.2, height: 0.2, layers: [point.layer!], connectedTo: [connection.name, port], circuitJsonMetadata: { pcb_smtpad_id: `pad_${ci}_${pi}`, pcb_port_id: port } })
    }
  }
  return { originalSrj: srj, srjWithPointPairs: srj, traces, fixedTraces: [] }
}
