import type {
  RegionHg,
  RegionId,
  RegionPortHg,
} from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types"
import type {
  assignDisconnectedTargetRegionNetIds,
  ConnectionAlias,
} from "lib/solvers/PortPointPathingSolver/tinyhypergraph/assignDisconnectedTargetRegionNetIds"
import { createTinyRouteNetIndexer } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/createTinyRouteNetIndexer"
import type { CapacityMeshNode } from "lib/types"

export const CLOCK_NET_ID = 0
export const FOREIGN_NET_ID = 1

type SplitPadContactFixture = Parameters<
  typeof assignDisconnectedTargetRegionNetIds
>[0] & {
  sideBranch: RegionHg
}

// terminal -- fragment -- nextFragment -- destination
//    |
// sideBranch (a dead end, never a substitute for reaching the destination)
export function createSplitPadContactFixture(
  fragmentOverrides: Partial<CapacityMeshNode> = {},
): SplitPadContactFixture {
  const terminal = createRegion("terminal", 0)
  const fragment = createRegion("fragment", 1)
  Object.assign(fragment.d, fragmentOverrides)
  const nextFragment = createRegion("next_fragment", 2)
  const destination = createRegion("destination", 3)
  destination.d._containsObstacle = false
  destination.d._containsTarget = false
  const sideBranch = createRegion("side_branch", 0)
  sideBranch.d.center.y = 1
  sideBranch.d._containsObstacle = false

  const regionPairs: [RegionHg, RegionHg][] = [
    [terminal, fragment],
    [fragment, nextFragment],
    [nextFragment, destination],
    [terminal, sideBranch],
  ]
  for (const [first, second] of regionPairs) {
    const portId = `${first.regionId}_${second.regionId}`
    const port: RegionPortHg = {
      portId,
      // Serialized graphs contain detached region references.
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
  }

  return {
    regions: [terminal, fragment, nextFragment, destination, sideBranch],
    connections: [
      {
        connectionId: "clock_mst0",
        mutuallyConnectedNetworkId: "clock",
        startRegion: { ...terminal, ports: [] },
        endRegion: { ...destination, ports: [] },
        simpleRouteConnection: {
          name: "clock_mst0",
          source_trace_id: "clock",
          pointsToConnect: [
            { x: 0, y: 0, layer: "top" },
            { x: 3, y: 0, layer: "top" },
          ],
        },
      },
    ],
    regionNetIdByRegionId: new Map<RegionId, number>([
      ["terminal", CLOCK_NET_ID],
      ["destination", -1],
    ]),
    regionNetCandidates: new Map<RegionId, Set<number>>(),
    netIndexByConnectionAlias: new Map<ConnectionAlias, number>([
      ["clock", CLOCK_NET_ID],
      ["foreign", FOREIGN_NET_ID],
    ]),
    getNetIndex: createTinyRouteNetIndexer(),
    sideBranch,
  }
}

function createRegion(regionId: RegionId, x: number): RegionHg {
  return {
    regionId,
    d: {
      capacityMeshNodeId: regionId,
      center: { x, y: 0 },
      width: 1,
      height: 1,
      availableZ: [0],
      layer: "z0",
      _containsObstacle: true,
      _containsTarget: true,
      _targetConnectionName: "clock",
    },
    ports: [],
  }
}
