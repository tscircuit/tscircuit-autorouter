import type { HyperGraph, Region, RegionPort } from "@tscircuit/hypergraph"
import type {
  InputNodeWithPortPoints,
  InputPortPoint,
} from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import type { CapacityMeshNodeId } from "lib/types"

export type HgRegion = Region & {
  d: InputNodeWithPortPoints
}

export type HgPort = RegionPort & {
  d: InputPortPoint
}

/**
 * Build a HyperGraph from input nodes and their port points.
 */
export function buildHyperGraphFromInputNodes({
  inputNodes,
}: {
  inputNodes: InputNodeWithPortPoints[]
}): {
  graph: HyperGraph
  regionMap: Map<CapacityMeshNodeId, HgRegion>
  portPointMap: Map<string, InputPortPoint>
} {
  const regionMap = new Map<CapacityMeshNodeId, HgRegion>()
  const portPointMap = new Map<string, InputPortPoint>()
  const regions: HgRegion[] = []
  const ports: HgPort[] = []

  for (const node of inputNodes) {
    const region: HgRegion = {
      regionId: node.capacityMeshNodeId,
      ports: [],
      assignments: [],
      d: node,
    }
    regions.push(region)
    regionMap.set(node.capacityMeshNodeId, region)
  }

  for (const node of inputNodes) {
    for (const portPoint of node.portPoints) {
      if (portPointMap.has(portPoint.portPointId)) {
        continue
      }
      portPointMap.set(portPoint.portPointId, portPoint)
      const [nodeId1, nodeId2] = portPoint.connectionNodeIds
      const region1 = regionMap.get(nodeId1)
      const region2 = regionMap.get(nodeId2)
      if (!region1 || !region2) {
        continue
      }
      const port: HgPort = {
        portId: portPoint.portPointId,
        region1,
        region2,
        d: portPoint,
      }
      ports.push(port)
      region1.ports.push(port)
      region2.ports.push(port)
    }
  }

  return {
    graph: {
      regions,
      ports,
    },
    regionMap,
    portPointMap,
  }
}
