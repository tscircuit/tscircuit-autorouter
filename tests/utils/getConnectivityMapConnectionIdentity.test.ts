import { expect, test } from "bun:test"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import type { SimpleRouteJson } from "lib/types"

test("connects every identity declared by a route", (): void => {
  const srj: SimpleRouteJson = {
    layerCount: 2,
    minTraceWidth: 0.2,
    bounds: { minX: 0, maxX: 10, minY: 0, maxY: 10 },
    connections: [
      {
        name: "route_a",
        __rootConnectionNames: ["root_a"],
        __netConnectionName: "net_a",
        pointsToConnect: [
          {
            x: 1,
            y: 2,
            layer: "top",
            pointId: "point_a",
            pcb_port_id: "pcb_port_a",
          },
        ],
      },
    ],
    obstacles: [],
  }

  const connMap = getConnectivityMapFromSimpleRouteJson(srj)

  for (const id of ["root_a", "net_a", "point_a", "pcb_port_a"]) {
    expect(connMap.areIdsConnected("route_a", id)).toBeTrue()
  }
})
