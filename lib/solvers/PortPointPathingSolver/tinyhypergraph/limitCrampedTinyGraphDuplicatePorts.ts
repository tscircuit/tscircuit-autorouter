import type { SerializedHyperGraph } from "@tscircuit/hypergraph"

type SerializedPort = SerializedHyperGraph["ports"][number]
type SerializedRegion = SerializedHyperGraph["regions"][number]

export type LimitCrampedTinyGraphDuplicatePortsInput = {
  readonly originalGraph: SerializedHyperGraph
  readonly proposedGraph: SerializedHyperGraph
}

export type LimitCrampedTinyGraphDuplicatePortsResult = {
  readonly graph: SerializedHyperGraph
  readonly removedPortIds: readonly string[]
}

/**
 * Conservatively avoid expanding producer-marked cramped port capacity.
 * Narrow-QFP edges can have multiple original cramped ports; all remain.
 * This is candidate admission, not a proof that every rejected lane is
 * physically impossible. Neither input nor retained port metadata is mutated.
 */
export function limitCrampedTinyGraphDuplicatePorts({
  originalGraph,
  proposedGraph,
}: LimitCrampedTinyGraphDuplicatePortsInput): LimitCrampedTinyGraphDuplicatePortsResult {
  const originalPortById = new Map<string, SerializedPort>()
  for (const port of originalGraph.ports) {
    originalPortById.set(port.portId, port)
  }
  const proposedPortIds = new Set<string>()
  const removedPortIds: string[] = []
  for (const port of proposedGraph.ports) {
    proposedPortIds.add(port.portId)
    if (originalPortById.has(port.portId)) continue

    const sourcePortId: unknown = port.d?.duplicatedFromPortId
    if (typeof sourcePortId !== "string") {
      throw new Error(
        `limitCrampedTinyGraphDuplicatePorts: new port "${port.portId}" has no original duplicate source`,
      )
    }
    const sourcePort = originalPortById.get(sourcePortId)
    if (!sourcePort) {
      throw new Error(
        `limitCrampedTinyGraphDuplicatePorts: new port "${port.portId}" references unknown original source "${sourcePortId}"`,
      )
    }
    if (sourcePort.d?.cramped === true) {
      removedPortIds.push(port.portId)
    }
  }
  for (const portId of originalPortById.keys()) {
    if (!proposedPortIds.has(portId)) {
      throw new Error(
        `limitCrampedTinyGraphDuplicatePorts: proposal is missing original port "${portId}"`,
      )
    }
  }

  if (removedPortIds.length === 0) {
    return { graph: proposedGraph, removedPortIds }
  }
  const removedPortIdSet = new Set(removedPortIds)
  return {
    graph: {
      ...proposedGraph,
      ports: proposedGraph.ports.filter(
        (port): boolean => !removedPortIdSet.has(port.portId),
      ),
      regions: proposedGraph.regions.map(
        (region): SerializedRegion => ({
          ...region,
          pointIds: region.pointIds.filter(
            (portId): boolean => !removedPortIdSet.has(portId),
          ),
        }),
      ),
    },
    removedPortIds,
  }
}
