import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type {
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import {
  createSharedCopperNodeRoutingPlan,
  type SharedCopperNodeRoutingPlan,
} from "./createSharedCopperNodeRoutingPlan"
export type { SharedCopperNodeRoutingPlan } from "./createSharedCopperNodeRoutingPlan"

/** Preserve authoritative traversals when a logical route revisits a region. */
export const createPairedSharedCopperNodeRoutingPlan = (
  node: NodeWithPortPoints,
  connMap: ConnectivityMap,
): SharedCopperNodeRoutingPlan => {
  const base = createSharedCopperNodeRoutingPlan(node, connMap)
  const points: PortPoint[] = []
  const pairs: [PortPoint, PortPoint][] = []
  const namesByRepresentative = new Map<string, string[]>()
  const reservedNames = new Set(
    node.portPoints.map((point) => point.connectionName),
  )
  let counter = 0
  for (const [representative, names] of base.connectionNamesByRepresentative) {
    const hops = base.routingNode.portPointsInPairs?.filter(
      ([start]) => start.connectionName === representative,
    )
    if (!hops?.length) {
      namesByRepresentative.set(representative, names)
      points.push(
        ...base.routingNode.portPoints.filter(
          (point) => point.connectionName === representative,
        ),
      )
      continue
    }
    // The detailed solver otherwise connects every same-name port as a star,
    // inventing connections (and vias) between independent regional visits.
    for (const [index, hop] of hops.entries()) {
      let physicalName = representative
      if (index > 0) {
        const root = hop[0].rootConnectionName ?? representative
        const net = connMap.getNetConnectedToId(root) ?? root
        do {
          physicalName = `${representative}__physical_hop_${encodeURIComponent(node.capacityMeshNodeId)}_${counter++}`
        } while (
          reservedNames.has(physicalName) ||
          (connMap.getNetConnectedToId(physicalName) !== undefined &&
            connMap.getNetConnectedToId(physicalName) !== net)
        )
        reservedNames.add(physicalName)
      }
      const physical: [PortPoint, PortPoint] = [
        { ...hop[0], connectionName: physicalName },
        { ...hop[1], connectionName: physicalName },
      ]
      namesByRepresentative.set(physicalName, names)
      points.push(...physical)
      pairs.push(physical)
    }
  }
  return {
    ...base,
    routingNode: {
      ...base.routingNode,
      portPoints: points,
      portPointsInPairs: node.portPointsInPairs ? pairs : undefined,
    },
    connectionNamesByRepresentative: namesByRepresentative,
  }
}
