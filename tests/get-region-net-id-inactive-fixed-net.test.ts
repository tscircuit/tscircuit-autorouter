import { expect, test } from "bun:test"
import type {
  ConnectionHgWithSimpleRouteConnection,
  HyperGraphHg,
  RegionHg,
} from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"
import { createTinyRouteNetIndexer } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/createTinyRouteNetIndexer"
import {
  BLOCKED_REGION_NET_ID,
  getRegionNetIdByRegionId,
} from "lib/solvers/PortPointPathingSolver/tinyhypergraph/getRegionNetIdByRegionId"
import type { CapacityMeshNode } from "lib/types"

const createRegion = (
  regionId: string,
  x: number,
  connectedTo?: string[],
  preloadedFixedNetIds?: string[],
): RegionHg => ({
  regionId,
  d: {
    capacityMeshNodeId: regionId,
    center: { x, y: 0 },
    width: 1,
    height: 1,
    layer: "top",
    availableZ: [0],
    _connectedTo: connectedTo,
    _preloadedFixedNetIds: preloadedFixedNetIds,
  } satisfies CapacityMeshNode,
  ports: [],
})

test("inactive fixed nets receive distinct hypergraph reservation ids", () => {
  const activeStartRegion = createRegion("active-start", 0)
  const activeEndRegion = createRegion("active-end", 2)
  const sameNetFixedRegion = createRegion(
    "same-net-fixed-region",
    8,
    undefined,
    ["active-net"],
  )
  const fixedRegion = createRegion("fixed-region", 10, undefined, ["fixed-net"])
  const graph: HyperGraphHg = {
    regions: [
      activeStartRegion,
      activeEndRegion,
      sameNetFixedRegion,
      fixedRegion,
    ],
    ports: [],
  }
  const activeConnection: ConnectionHgWithSimpleRouteConnection = {
    connectionId: "active-connection",
    mutuallyConnectedNetworkId: "active-net",
    startRegion: activeStartRegion,
    endRegion: activeEndRegion,
    simpleRouteConnection: {
      name: "active-connection",
      __rootConnectionNames: ["active-net"],
      pointsToConnect: [
        { x: 0, y: 0, layer: "top" },
        { x: 2, y: 0, layer: "top" },
      ],
    },
  }
  type RegionNetParams = Parameters<
    typeof getRegionNetIdByRegionId
  >[0]["params"]
  const getNetIndex = createTinyRouteNetIndexer()

  const regionNetIds = getRegionNetIdByRegionId({
    params: {
      graph,
      connections: [activeConnection],
      layerCount: 2,
    } as RegionNetParams,
    getNetIndex,
  })

  expect(regionNetIds.get("active-start")).toBe(0)
  expect(regionNetIds.get("active-end")).toBe(0)
  expect(regionNetIds.get("same-net-fixed-region")).toBe(0)
  expect(regionNetIds.get("fixed-region")).toBe(1)
})

test("fixed canonical names do not alias unrelated point-pair ids", () => {
  const activeStartRegion = createRegion("active-start", 0)
  const activeEndRegion = createRegion("active-end", 2)
  const fixedRegion = createRegion("fixed-region", 10, undefined, [
    "route_mst0",
  ])
  const graph: HyperGraphHg = {
    regions: [activeStartRegion, activeEndRegion, fixedRegion],
    ports: [],
  }
  const activeConnection: ConnectionHgWithSimpleRouteConnection = {
    connectionId: "route_mst0",
    mutuallyConnectedNetworkId: "connectivity_net0",
    startRegion: activeStartRegion,
    endRegion: activeEndRegion,
    simpleRouteConnection: {
      name: "route_mst0",
      __rootConnectionNames: ["route"],
      pointsToConnect: [
        { x: 0, y: 0, layer: "top" },
        { x: 2, y: 0, layer: "top" },
      ],
    },
  }
  type RegionNetParams = Parameters<
    typeof getRegionNetIdByRegionId
  >[0]["params"]

  const regionNetIds = getRegionNetIdByRegionId({
    params: {
      graph,
      connections: [activeConnection],
      layerCount: 2,
    } as RegionNetParams,
    getNetIndex: createTinyRouteNetIndexer(),
  })

  expect(regionNetIds.get("active-start")).toBe(0)
  expect(regionNetIds.get("active-end")).toBe(0)
  expect(regionNetIds.get("fixed-region")).toBe(1)
})

test("regions occupied by multiple fixed nets are blocked", () => {
  const fixedConflictRegion = createRegion("fixed-conflict", 0, undefined, [
    "fixed-a",
    "fixed-b",
  ])
  const graph: HyperGraphHg = {
    regions: [fixedConflictRegion],
    ports: [],
  }
  type RegionNetParams = Parameters<
    typeof getRegionNetIdByRegionId
  >[0]["params"]

  const regionNetIds = getRegionNetIdByRegionId({
    params: {
      graph,
      connections: [],
      layerCount: 2,
    } as unknown as RegionNetParams,
    getNetIndex: createTinyRouteNetIndexer(),
  })

  expect(regionNetIds.get("fixed-conflict")).toBe(BLOCKED_REGION_NET_ID)
})
