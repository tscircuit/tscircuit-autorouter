import { expect, test } from "bun:test"
import { compileSharedElectricalTrees } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/compileSharedElectricalTrees"
import { createElectricalTreeRepairWalks } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/createElectricalTreeRepairWalks"
import type { NodeWithPortPoints, PortPoint, HighDensityRoute } from "lib/types/high-density-types"
import type { SimpleRouteConnection } from "lib/types"

test("a constrained canonical net retains every native logical path while an unrelated net still compiles shared copper", (): void => {
  const point = (id: string, x: number, y: number, owner: string, terminal = true): PortPoint => ({ portPointId: id, electricalVertexId: id,
    electricalTerminalId: terminal ? id : undefined, pcb_port_id: terminal ? id : undefined, connectionName: owner, x, y, z: 0 })
  const pairs: Array<[PortPoint, PortPoint]> = []
  const connections: SimpleRouteConnection[] = []
  const endpoints = new Map<string, readonly [string, string]>()
  const nets = new Map<string, string>()
  for (const [name, a, b, x, y, root, width] of [
    ["ab", "A", "B", 0, 0, "constrained", 0.1], ["cb", "C", "B", 0, 2, "constrained", 0.3],
    ["ef", "E", "F", 5, 0, "shared", 0.1], ["gf", "G", "F", 5, 2, "shared", 0.2],
  ] as const) {
    const start = point(a, x, y, name), middle = point(root === "shared" ? "K" : "J", x + 1, 1, name, false), end = point(b, x + 2, 1, name)
    pairs.push([start, middle], [middle, end])
    connections.push({ name, nominalTraceWidth: width, __rootConnectionNames: [root], pointsToConnect: [
      { x: start.x, y: start.y, layer: "top", pcb_port_id: a }, { x: end.x, y: end.y, layer: "top", pcb_port_id: b },
    ] })
    endpoints.set(name, [a, b])
    nets.set(name, root)
  }
  const node: NodeWithPortPoints = { capacityMeshNodeId: "cell", center: { x: 4, y: 1 }, width: 10, height: 4, availableZ: [0], portPoints: pairs.flat(), portPointsInPairs: pairs }
  const output = compileSharedElectricalTrees({ nodes: [node], connections, netByConnection: nets, demandEndpoints: endpoints,
    excludedConnections: new Set(), nativeNetIds: new Set(["constrained"]), layerCount: 2 })
  expect(output.stats.electricalTreeNativePathNetCount).toBe(1)
  expect(output.stats.electricalTreeNativePathDemandCount).toBe(2)
  expect(output.stats.electricalTreeVerifiedDemandCount).toBe(4)
  expect(output.stats.electricalTreeSharedEdgeCount).toBeGreaterThan(0)
  expect(output.connections.filter((connection) => connection.electricalBranch!.nativeLogicalPath).map((connection) => connection.name)).toEqual(["ab", "cb"])
  for (const original of connections.slice(0, 2)) {
    expect(output.connections.find((connection) => connection.name === original.name)).toMatchObject(original)
    expect(output.nodesWithPortPoints.flatMap((entry) => entry.portPointsInPairs ?? []).filter((pair) => pair[0].connectionName === original.name))
      .toEqual(pairs.filter((pair) => pair[0].connectionName === original.name))
  }
  const routes: HighDensityRoute[] = output.connections.map((connection) => ({ connectionName: connection.name, rootConnectionName: connection.__rootConnectionNames![0],
    traceThickness: connection.nominalTraceWidth!, viaDiameter: 0.3, route: connection.pointsToConnect.map((point) => ({ ...point, z: 0 })), vias: [] }))
  const walks = createElectricalTreeRepairWalks({ connections: output.connections, routes })
  expect(walks.routes.find((route) => route.connectionName === "ab")!.route).toEqual(routes.find((route) => route.connectionName === "ab")!.route)
  expect(walks.routes.find((route) => route.connectionName === "cb")!.route).toEqual(routes.find((route) => route.connectionName === "cb")!.route)
  expect(walks.decode(walks.routes)).toHaveLength(routes.length)
})
