import { expect, test } from "bun:test"
import type {
  ConnectionHgWithSimpleRouteConnection,
  RegionHg,
  RegionId,
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
  const regionById = new Map<RegionId, RegionHg>(
    regions.map((region): [RegionId, RegionHg] => [region.regionId, region]),
  )
  const regionPairs: [RegionId, RegionId][] = [
    ["start_a", "fragment_a"],
    ["fragment_a", "outer_a"],
    ["outer_a", "exit_a"],
    ["exit_a", "end_a"],
    ["start_a", "pocket_a"],
    ["start_b", "exit_b"],
    ["exit_b", "end_b"],
    ["start_b", "fragment_b"],
    ["start_a", "corner_a"],
    ["start_a", "unknown"],
    ["start_a", "foreign"],
    ["fragment_a", "conflicting"],
    ["outer_a", "free_tagged"],
  ]
  const ports: RegionPortHg[] = []
  for (const [firstRegionId, secondRegionId] of regionPairs) {
    const first = regionById.get(firstRegionId)!
    const second = regionById.get(secondRegionId)!
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
    { id: "clock_a", net: "net_a", start: "start_a", end: "end_a" },
    { id: "clock_b", net: "net_b", start: "start_b", end: "end_b" },
  ].map(({ id, net, start, end }): ConnectionHgWithSimpleRouteConnection => {
    const startRegion = regionById.get(start)!
    const endRegion = regionById.get(end)!
    return {
      connectionId: `${id}_mst0`,
      mutuallyConnectedNetworkId: net,
      startRegion: { ...startRegion, ports: [] },
      endRegion: { ...endRegion, ports: [] },
      simpleRouteConnection: {
        name: `${id}_mst0`,
        source_trace_id: id,
        pointsToConnect: [startRegion, endRegion].map(
          (region): { x: number; y: number; layer: string } => ({
            ...region.d.center,
            layer: "top",
          }),
        ),
      },
    }
  })
  const graph = { regions, ports }
  const originalGraph = structuredClone(graph)
  const regionNetIdByRegionId = getRegionNetIdByRegionId({
    params: { graph, connections, layerCount: 2 },
    getNetIndex: createTinyRouteNetIndexer(),
  })

  expect(regionNetIdByRegionId.get("fragment_a")).toBe(
    regionNetIdByRegionId.get("start_a"),
  )
  expect(regionNetIdByRegionId.get("outer_a")).toBe(
    regionNetIdByRegionId.get("start_a"),
  )
  expect(regionNetIdByRegionId.get("start_a")).not.toBe(
    regionNetIdByRegionId.get("start_b"),
  )
  expect(regionNetIdByRegionId.get("foreign")).toBe(
    regionNetIdByRegionId.get("start_b"),
  )
  for (const id of [
    "fragment_b",
    "corner_a",
    "unknown",
    "conflicting",
    "pocket_a",
    "exit_a",
    "free_tagged",
  ]) {
    expect(regionNetIdByRegionId.has(id)).toBe(false)
  }
  expect(graph).toEqual(originalGraph)
})
