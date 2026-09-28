import { expect, test } from "bun:test"
import { getRegionNetIdByRegionId } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/getRegionNetIdByRegionId"
import { createTinyRouteNetIndexer } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/createTinyRouteNetIndexer"
import type {
  ConnectionHgWithSimpleRouteConnection,
  HgPortPointPathingSolverParams,
  RegionHg,
} from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"

test("canonical copper net IDs cannot be overwritten by connection aliases", (): void => {
  const region: RegionHg = {
    regionId: "copper",
    ports: [],
    d: {
      capacityMeshNodeId: "copper",
      center: { x: 0, y: 0 },
      width: 1,
      height: 1,
      availableZ: [0],
      layer: "z0",
      _connectedTo: ["net-a"],
    },
  }
  const connections: ConnectionHgWithSimpleRouteConnection[] = [
    ["route-a", "net-a"],
    ["net-a", "net-b"],
  ].map(
    ([
      connectionId,
      mutuallyConnectedNetworkId,
    ]): ConnectionHgWithSimpleRouteConnection => ({
      connectionId: connectionId!,
      mutuallyConnectedNetworkId: mutuallyConnectedNetworkId!,
      startRegion: region,
      endRegion: region,
      simpleRouteConnection: {
        name: connectionId!,
        pointsToConnect: [
          { x: 10, y: 10, layer: "top" },
          { x: 11, y: 10, layer: "top" },
        ],
      },
    }),
  )
  // Endpoints are deliberately outside this copper region: ownership comes
  // from _connectedTo, which buildHyperGraph normalizes to canonical net IDs.
  for (const orderedConnections of [connections, [...connections].reverse()]) {
    const getNetIndex = createTinyRouteNetIndexer()
    const params = {
      graph: { regions: [region], ports: [] },
      connections: orderedConnections,
      layerCount: 2,
      effort: 0.01,
      flags: { FORCE_CENTER_FIRST: false, RIPPING_ENABLED: false },
      weights: {} as HgPortPointPathingSolverParams["weights"],
    } as HgPortPointPathingSolverParams & {
      connections: ConnectionHgWithSimpleRouteConnection[]
    }
    const ownership = getRegionNetIdByRegionId({ params, getNetIndex })
    expect(ownership.get("copper")).toBe(getNetIndex(connections[0]!))
    expect(ownership.get("copper")).not.toBe(getNetIndex(connections[1]!))
  }
})
