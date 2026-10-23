import { expect, test } from "bun:test"
import { ConnectivityMap } from "connectivity-map"
import { normalizeSharedElectricalTreeRouteEndpoints } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/normalizeSharedElectricalTreeRouteEndpoints"
import { assertSharedElectricalTreeRoutes } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/assertSharedElectricalTreeRoutes"
import type { HighDensityRoute } from "lib/types/high-density-types"
import type { SimpleRouteConnection } from "lib/types"

test("native endpoint roundoff converts atomically to shared vertices and via sites while real movement remains an error", (): void => {
  const connMap = new ConnectivityMap({})
  connMap.addConnections([["bus", "aj", "jk", "kb"], ["foreign"]])
  const shifted = 1 + Number.EPSILON
  const connections: SimpleRouteConnection[] = [
    { name: "aj", pointsToConnect: [{ x: 0, y: 0, layer: "top", pcb_port_id: "A" }, { x: 1, y: 0, layer: "top" }],
      electricalBranch: { netId: "bus", startVertexId: "A", endVertexId: "J", logicalConnectionNames: ["aj"] } },
    { name: "jk", pointsToConnect: [{ x: 1, y: 0, layer: "top" }, { x: 1, y: 0, layer: "bottom" }],
      electricalBranch: { netId: "bus", startVertexId: "J", endVertexId: "K", logicalConnectionNames: ["jk"] } },
    { name: "kb", pointsToConnect: [{ x: 1, y: 0, layer: "bottom" }, { x: 2, y: 0, layer: "bottom", pcb_port_id: "B" }],
      electricalBranch: { netId: "bus", startVertexId: "K", endVertexId: "B", logicalConnectionNames: ["kb"] } },
  ]
  const route = (connectionName: string, points: HighDensityRoute["route"]): HighDensityRoute => ({ connectionName, rootConnectionName: "bus", traceThickness: 0.1, viaDiameter: 0.3, route: points, vias: [] })
  const routes = [route("aj", [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }]),
    { ...route("jk", [{ x: shifted, y: 0, z: 0 }, { x: shifted, y: 0, z: 1 }]), vias: [{ x: shifted, y: 0 }] },
    route("kb", [{ x: shifted, y: 0, z: 1 }, { x: 2, y: 0, z: 1 }])]
  const normalized = normalizeSharedElectricalTreeRouteEndpoints({ connections, routes, layerCount: 2, connMap })
  expect(normalized.normalizedEndpoints).toBe(3)
  expect(normalized.normalizedViaPoints).toBeGreaterThan(0)
  expect(normalized.normalizedViaRecords).toBe(1)
  expect(normalized.maxDisplacement).toBe(Number.EPSILON)
  expect(normalized.routes[1]!.route).toEqual([{ x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 1 }])
  expect(normalized.routes[1]!.vias).toEqual([{ x: 1, y: 0 }])
  expect(normalized.routes[2]!.route[0]!.x).toBe(1)
  expect(normalized.routes[0]!.route[0]!.pcb_port_id).toBe("A")
  expect(normalized.routes[2]!.route.at(-1)!.pcb_port_id).toBe("B")
  expect(routes[1]!.route[0]!.x).toBe(shifted)
  expect(routes[1]!.vias[0]!.x).toBe(shifted)
  expect(() => assertSharedElectricalTreeRoutes({ connections, routes: normalized.routes, layerCount: 2 })).not.toThrow()
  expect(normalizeSharedElectricalTreeRouteEndpoints({ connections, routes: normalized.routes, layerCount: 2, connMap }).normalizedEndpoints).toBe(0)
  const tooFar = structuredClone(routes)
  tooFar[1]!.route.forEach((point) => { point.x = 1 + 65 * Number.EPSILON })
  tooFar[1]!.vias[0]!.x = 1 + 65 * Number.EPSILON
  expect(() => normalizeSharedElectricalTreeRouteEndpoints({ connections, routes: tooFar, layerCount: 2, connMap })).toThrow("exceeds roundoff")
  const movedPad = structuredClone(routes)
  movedPad[0]!.route[0]!.x = 0.01
  expect(() => normalizeSharedElectricalTreeRouteEndpoints({ connections, routes: movedPad, layerCount: 2, connMap })).toThrow("exceeds roundoff")
  const wrongPad = structuredClone(routes)
  wrongPad[0]!.route[0]!.pcb_port_id = "foreign"
  expect(() => normalizeSharedElectricalTreeRouteEndpoints({ connections, routes: wrongPad, layerCount: 2, connMap })).toThrow("conflicting PCB identity")
  const wrongLayer = structuredClone(routes)
  wrongLayer[0]!.route.at(-1)!.z = 1
  expect(() => normalizeSharedElectricalTreeRouteEndpoints({ connections, routes: wrongLayer, layerCount: 2, connMap })).toThrow("changed layer")
  const wrongRouteRoot = structuredClone(routes)
  wrongRouteRoot[1]!.rootConnectionName = "foreign"
  expect(() => normalizeSharedElectricalTreeRouteEndpoints({ connections, routes: wrongRouteRoot, layerCount: 2, connMap })).toThrow("uncertified route root")
  const wrongRoot = structuredClone(connections)
  wrongRoot[1]!.electricalBranch!.netId = "foreign"
  expect(() => normalizeSharedElectricalTreeRouteEndpoints({ connections: wrongRoot, routes, layerCount: 2, connMap })).toThrow("uncertified route root")
  const canonicalConnections = structuredClone(connections)
  const canonicalRoot = connMap.getNetConnectedToId("aj")!
  canonicalConnections.forEach((connection) => { connection.electricalBranch!.netId = canonicalRoot })
  const canonicalRoutes = structuredClone(routes)
  canonicalRoutes.forEach((route) => { route.rootConnectionName = canonicalRoot })
  connMap.addConnections([["foreign", canonicalRoot]])
  expect(connMap.getNetConnectedToId(canonicalRoot)).not.toBe(canonicalRoot)
  expect(normalizeSharedElectricalTreeRouteEndpoints({ connections: canonicalConnections, routes: canonicalRoutes, layerCount: 2, connMap }).normalizedEndpoints).toBe(3)
  const movedJunction = structuredClone(normalized.routes)
  movedJunction[0]!.route.at(-1)!.x = 1.01
  expect(() => normalizeSharedElectricalTreeRouteEndpoints({ connections, routes: movedJunction, layerCount: 2, connMap, preserveJunctionPositions: true })).toThrow("exceeds roundoff")
})
