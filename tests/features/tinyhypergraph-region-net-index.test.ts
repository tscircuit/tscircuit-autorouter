import { expect, test } from "bun:test"
import type {
  ConnectionHgWithSimpleRouteConnection,
  RegionHg,
} from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"
import { createTinyRouteNetIndexer } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/createTinyRouteNetIndexer"
import { getRegionNetIdByRegionId } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/getRegionNetIdByRegionId"
import type { CapacityMeshNodeId } from "lib/types"

const createRegion = (
  regionId: CapacityMeshNodeId,
  x: number,
  availableZ: number[],
): RegionHg => ({
  regionId,
  ports: [],
  d: {
    capacityMeshNodeId: regionId,
    center: { x, y: 0 },
    width: 2,
    height: 2,
    layer: `z${availableZ[0]}`,
    availableZ,
    _containsTarget: true,
  },
})

test("region net lookup keeps every overlapping region on a shared layer", () => {
  const firstTopRegion = createRegion("first-top", 0, [0])
  const secondTopRegion = createRegion("second-top", 0, [0])
  const bottomRegion = createRegion("bottom", 0, [1])
  const nearBoundaryRegion = createRegion("near-boundary", 1.0005, [0])
  const farRegion = createRegion("far", 20, [0])
  const connection: ConnectionHgWithSimpleRouteConnection = {
    connectionId: "route-a",
    mutuallyConnectedNetworkId: "signal-net",
    startRegion: firstTopRegion,
    endRegion: firstTopRegion,
    simpleRouteConnection: {
      name: "route-a",
      pointsToConnect: [
        { x: 0, y: 0, layer: "top", pcb_port_id: "pcb_port_a" },
      ],
    },
  }

  const regionNetIdByRegionId = getRegionNetIdByRegionId({
    params: {
      graph: {
        regions: [
          firstTopRegion,
          secondTopRegion,
          bottomRegion,
          nearBoundaryRegion,
          farRegion,
        ],
        ports: [],
      },
      connections: [connection],
      layerCount: 2,
      effort: 1,
    },
    getNetIndex: createTinyRouteNetIndexer(),
  })

  expect([...regionNetIdByRegionId]).toEqual([
    ["first-top", 0],
    ["second-top", 0],
    ["near-boundary", 0],
  ])
})
