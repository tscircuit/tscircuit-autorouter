import { expect } from "bun:test"
import { NetToPointPairsSolver2_OffBoardConnection } from "lib/solvers/NetToPointPairsSolver2_OffBoardConnection/NetToPointPairsSolver2_OffBoardConnection"
import type { SimpleRouteJson } from "lib/types"
import { getInitiallyConnectedMapFromSimpleRouteJson } from "lib/utils/get-initially-connected-map-from-simple-route-json"
import capturedSrj from "./ordered-trace-path.srj.json" with { type: "json" }

export function checkOrderedTraceOffboardPads(hopCount: 1 | 2): void {
  const srj = structuredClone(capturedSrj) as SimpleRouteJson
  const path = srj.connections[0]!
  path.pointsToConnect = path.pointsToConnect.slice(0, hopCount + 1)
  path.path = path.path!.slice(0, hopCount + 1)
  const a = path.pointsToConnect[1]!
  const alias = srj.obstacles.find(
    (obstacle) => obstacle.circuitJsonMetadata?.pcb_port_id === "pcb_port_3",
  )!
  srj.connections.push({
    name: "offboard",
    isOffBoard: true,
    pointsToConnect: [
      a,
      { ...alias.center, layer: "top", pointId: "pcb_port_3" },
    ],
  })
  srj.connections.push({
    ...path,
    name: "reverse",
    pointsToConnect: [...path.pointsToConnect].reverse(),
    path: [...path.path!].reverse(),
  })
  const solver = new NetToPointPairsSolver2_OffBoardConnection(
    srj,
    {},
    getInitiallyConnectedMapFromSimpleRouteJson(srj),
  )
  solver.solve()
  expect(
    solver.newConnections.map(({ pointsToConnect }) =>
      pointsToConnect.map((point) => point.pointId),
    ),
  ).toEqual(path.path!.slice(1).map((to, index) => [path.path![index], to]))
  const names = solver.newConnections.map((connection) => connection.name)
  expect(solver.pathHopConnectionNames.get(path.name)).toEqual(names)
  expect(solver.pathHopConnectionNames.get("reverse")).toEqual(
    [...names].reverse(),
  )
}
