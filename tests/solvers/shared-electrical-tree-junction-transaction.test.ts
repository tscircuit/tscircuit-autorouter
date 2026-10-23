import { expect, test } from "bun:test"
import { moveElectricalTreeJunction } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/moveElectricalTreeJunction"
import { assertSharedElectricalTreeRoutes } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/assertSharedElectricalTreeRoutes"
import type { SimpleRouteConnection } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

test("a junction transaction moves all incident endpoints and a shared via without changing pads, preloads or another net", (): void => {
  const connections: SimpleRouteConnection[] = ["a", "b"].map((name, index) => ({ name,
    pointsToConnect: [{ x: index === 0 ? -1 : 1, y: 0, layer: index === 0 ? "top" : "bottom", pcb_port_id: name }, { x: 0, y: 0, layer: "top", pointId: "J" }],
    electricalBranch: { netId: "bus", startVertexId: name, endVertexId: "J", logicalConnectionNames: ["bus"] } }))
  const routes: HighDensityRoute[] = [
    { connectionName: "a", traceThickness: 0.1, viaDiameter: 0.3, route: [{ x: -1, y: 0, z: 0, pcb_port_id: "a" }, { x: 0, y: 0, z: 0 }], vias: [] },
    { connectionName: "b", traceThickness: 0.1, viaDiameter: 0.3, route: [{ x: 1, y: 0, z: 1, pcb_port_id: "b" }, { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: 0 }], vias: [{ x: 0, y: 0 }] },
    { connectionName: "preload", traceThickness: 0.1, viaDiameter: 0.3, route: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }], vias: [] },
  ]
  const original = structuredClone(routes)
  const moved = moveElectricalTreeJunction({ connections, routes, vertexId: "J", dx: 0.4, dy: 0.2 })!
  assertSharedElectricalTreeRoutes({ connections, routes: moved.slice(0, 2), layerCount: 2 })
  expect(moved[0]!.route.at(-1)).toEqual({ x: 0.4, y: 0.2, z: 0 })
  expect(moved[1]!.route.slice(1)).toEqual([{ x: 0.4, y: 0.2, z: 1 }, { x: 0.4, y: 0.2, z: 0 }])
  expect(moved[1]!.vias).toEqual([{ x: 0.4, y: 0.2 }])
  expect(moved[0]!.route[0]).toEqual(routes[0]!.route[0])
  expect(moved[1]!.route[0]).toEqual(routes[1]!.route[0])
  expect(moved[2]).toBe(routes[2]!)
  expect(routes).toEqual(original)
  expect(moveElectricalTreeJunction({ connections, routes, vertexId: "a", dx: 0.4, dy: 0.2 })).toBeUndefined()
  const protectedRoutes = structuredClone(routes)
  protectedRoutes[1]!.route[1]!.toNextSegmentType = "through_obstacle"
  expect(moveElectricalTreeJunction({ connections, routes: protectedRoutes, vertexId: "J", dx: 0.4, dy: 0.2 })).toBeUndefined()
  const disconnected = structuredClone(routes)
  disconnected[1]!.route.at(-1)!.x = 0.01
  expect(() => moveElectricalTreeJunction({ connections, routes: disconnected, vertexId: "J", dx: 0.4, dy: 0.2 })).toThrow("disconnected ownership")
  const columnConnections = structuredClone(connections)
  columnConnections[1]!.pointsToConnect[1]!.layer = "bottom"
  columnConnections[1]!.electricalBranch!.endVertexId = "lowerJ"
  columnConnections.push({ name: "via", pointsToConnect: [{ x: 0, y: 0, layer: "top", pointId: "J" }, { x: 0, y: 0, layer: "bottom", pointId: "lowerJ" }],
    electricalBranch: { netId: "bus", startVertexId: "J", endVertexId: "lowerJ", logicalConnectionNames: ["bus"] } })
  const columnRoutes = structuredClone(routes.slice(0, 2))
  columnRoutes[1]!.route.pop()
  columnRoutes[1]!.vias = []
  columnRoutes.push({ connectionName: "via", traceThickness: 0.1, viaDiameter: 0.3, route: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }], vias: [{ x: 0, y: 0 }] })
  const column = moveElectricalTreeJunction({ connections: columnConnections, routes: columnRoutes, vertexId: "J", dx: 0.4, dy: 0.2 })!
  assertSharedElectricalTreeRoutes({ connections: columnConnections, routes: column, layerCount: 2 })
  expect(column[0]!.route.at(-1)).toEqual({ x: 0.4, y: 0.2, z: 0 })
  expect(column[1]!.route.at(-1)).toEqual({ x: 0.4, y: 0.2, z: 1 })
  expect(column[2]!.vias).toEqual([{ x: 0.4, y: 0.2 }])
})
