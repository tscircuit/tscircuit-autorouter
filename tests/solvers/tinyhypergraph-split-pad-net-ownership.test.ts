import { expect, test } from "bun:test"
import type {
  ConnectionHgWithSimpleRouteConnection,
  RegionHg,
  RegionPortHg,
} from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"
import { createTinyRouteNetIndexer } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/createTinyRouteNetIndexer"
import { getRegionNetIdByRegionId } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/getRegionNetIdByRegionId"

test("disconnected terminals recover same-pad contacts without changing reachable routes", (): void => {
  const regions: RegionHg[] = [
    { id: "start_a", x: 0, y: 0, target: "clock_a", obstacle: true },
    { id: "fragment_a", x: 1, y: 0, target: "clock_a", obstacle: true },
    { id: "outer_a", x: 2, y: 0, target: "clock_a", obstacle: true },
    { id: "exit_a", x: 3, y: 0, obstacle: false },
    { id: "end_a", x: 4, y: 0, target: "clock_a", obstacle: true },
    { id: "pocket_a", x: 0, y: 1, obstacle: false },
    { id: "start_b", x: 0, y: 5, target: "clock_b", obstacle: true },
    { id: "exit_b", x: 1, y: 5, obstacle: false },
    { id: "end_b", x: 2, y: 5, target: "clock_b", obstacle: true },
    { id: "fragment_b", x: 0, y: 6, target: "clock_b", obstacle: true },
    { id: "corner_a", x: -1, y: -1, target: "clock_a", obstacle: true },
    {
      id: "unknown",
      x: 0,
      y: -1,
      target: "clock_a",
      obstacle: true,
      connectedTo: ["unknown_net"],
    },
    {
      id: "foreign",
      x: -1,
      y: 0,
      target: "clock_b",
      obstacle: true,
      connectedTo: ["net_b"],
    },
    {
      id: "conflicting",
      x: 1,
      y: 1,
      target: "clock_a",
      obstacle: true,
      connectedTo: ["net_a", "net_b"],
    },
    { id: "free_tagged", x: 2, y: 1, target: "clock_a", obstacle: false },
  ].map(({ id, x, y, target, obstacle, connectedTo }): RegionHg => ({
    regionId: id,
    d: {
      capacityMeshNodeId: id,
      center: { x, y },
      width: 1,
      height: 1,
      availableZ: [0],
      layer: "z0",
      _containsObstacle: obstacle,
      _containsTarget: target !== undefined,
      _targetConnectionName: target,
      _connectedTo: connectedTo,
    },
    ports: [],
  }))
  const ports: RegionPortHg[] = []
  for (const [firstIndex, secondIndex] of [
    [0, 1],
    [1, 2],
    [2, 3],
    [3, 4],
    [0, 5],
    [6, 7],
    [7, 8],
    [6, 9],
    [0, 10],
    [0, 11],
    [0, 12],
    [1, 13],
    [2, 14],
  ]) {
    const first = regions[firstIndex!]!
    const second = regions[secondIndex!]!
    const portId = `port_${ports.length}`
    const port: RegionPortHg = {
      portId,
      region1: { ...first, ports: [] },
      region2: { ...second, ports: [] },
      d: {
        portId,
        x: (first.d.center.x + second.d.center.x) / 2,
        y: (first.d.center.y + second.d.center.y) / 2,
        z: 0,
        distToCentermostPortOnZ: 0,
        regions: [first, second],
      },
    }
    first.ports.push(port)
    second.ports.push(port)
    ports.push(port)
  }
  const connections: ConnectionHgWithSimpleRouteConnection[] = [
    { id: "clock_a", net: "net_a", start: 0, end: 4 },
    { id: "clock_b", net: "net_b", start: 6, end: 8 },
  ].map(({ id, net, start, end }): ConnectionHgWithSimpleRouteConnection => ({
    connectionId: `${id}_mst0`,
    mutuallyConnectedNetworkId: net,
    startRegion: { ...regions[start]!, ports: [] },
    endRegion: { ...regions[end]!, ports: [] },
    simpleRouteConnection: {
      name: `${id}_mst0`,
      source_trace_id: id,
      pointsToConnect: [regions[start]!, regions[end]!].map(
        (region): { x: number; y: number; layer: string } => ({
          ...region.d.center,
          layer: "top",
        }),
      ),
    },
  }))
  const graph = { regions, ports }
  const originalGraph = structuredClone(graph)
  const ownership = getRegionNetIdByRegionId({
    params: { graph, connections, layerCount: 2 },
    getNetIndex: createTinyRouteNetIndexer(),
  })

  expect(ownership.get("fragment_a")).toBe(ownership.get("start_a"))
  expect(ownership.get("outer_a")).toBe(ownership.get("start_a"))
  expect(ownership.get("start_a")).not.toBe(ownership.get("start_b"))
  expect(ownership.get("foreign")).toBe(ownership.get("start_b"))
  for (const id of [
    "fragment_b",
    "corner_a",
    "unknown",
    "conflicting",
    "pocket_a",
    "exit_a",
    "free_tagged",
  ]) {
    expect(ownership.has(id)).toBe(false)
  }
  expect(graph).toEqual(originalGraph)
})
