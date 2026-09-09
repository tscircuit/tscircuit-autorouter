import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { getPhysicalCutIdOrThrow } from "lib/solvers/AvailableSegmentPointSolver/getPhysicalCutIdOrThrow"

type SerializedPort = SerializedHyperGraph["ports"][number]
type SerializedRegion = SerializedHyperGraph["regions"][number]

export type LimitCrampedTinyGraphDuplicatePortsInput = {
  readonly originalGraph: SerializedHyperGraph
  readonly proposedGraph: SerializedHyperGraph
}

export type LimitCrampedTinyGraphDuplicatePortsResult = {
  readonly graph: SerializedHyperGraph
  readonly removedPortIds: readonly string[]
  /** Reason subsets can overlap; removedPortIds remains the distinct total. */
  readonly removedCrampedPortIds: readonly string[]
  readonly removedPhysicalCutPortIds: readonly string[]
}

/**
 * Avoid expanding producer-marked cramped or finite physical-cut capacity.
 * Narrow-QFP edges can have multiple original cramped ports; all remain.
 * A finite cut can likewise retain multiple original sites on each layer.
 * This is candidate admission, not a proof that every rejected lane is
 * physically impossible. Neither input nor retained port metadata is mutated.
 */
export function limitCrampedTinyGraphDuplicatePorts({
  originalGraph,
  proposedGraph,
}: LimitCrampedTinyGraphDuplicatePortsInput): LimitCrampedTinyGraphDuplicatePortsResult {
  const originalPortById = new Map<string, SerializedPort>()
  const originalPhysicalCutIdByPortId = new Map<string, string>()
  for (const port of originalGraph.ports) {
    originalPortById.set(port.portId, port)
    const physicalCutId = getPhysicalCutIdOrThrow(
      port.d?.physicalCutId,
      port.portId,
    )
    if (physicalCutId !== undefined) {
      originalPhysicalCutIdByPortId.set(port.portId, physicalCutId)
    }
  }
  const proposedPortIds = new Set<string>()
  const removedPortIds: string[] = []
  const removedCrampedPortIds: string[] = []
  const removedPhysicalCutPortIds: string[] = []
  for (const port of proposedGraph.ports) {
    proposedPortIds.add(port.portId)
    const physicalCutId = getPhysicalCutIdOrThrow(
      port.d?.physicalCutId,
      port.portId,
    )
    if (originalPortById.has(port.portId)) {
      if (physicalCutId !== originalPhysicalCutIdByPortId.get(port.portId)) {
        throw new Error(
          `limitCrampedTinyGraphDuplicatePorts: proposal changed physicalCutId of original port "${port.portId}"`,
        )
      }
      continue
    }

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
    const sourceIsCramped = sourcePort.d?.cramped === true
    const sourceHasPhysicalCut =
      originalPhysicalCutIdByPortId.get(sourcePortId) !== undefined
    if (sourceIsCramped) removedCrampedPortIds.push(port.portId)
    if (sourceHasPhysicalCut) removedPhysicalCutPortIds.push(port.portId)
    if (sourceIsCramped || sourceHasPhysicalCut) {
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
    return {
      graph: proposedGraph,
      removedPortIds,
      removedCrampedPortIds,
      removedPhysicalCutPortIds,
    }
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
    removedCrampedPortIds,
    removedPhysicalCutPortIds,
  }
}
