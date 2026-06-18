import {
  CRAMPED_PORT_TRAVERSAL_PENALTY,
  DUPLICATE_PORT_TRAVERSAL_PENALTY,
  type LoadedTinyGraph,
  type TinyPortMetadata,
  type TinyRegionMetadata,
} from "./types"

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

export const getTinyPortMetadata = (metadata: unknown): TinyPortMetadata =>
  isRecord(metadata) ? (metadata as TinyPortMetadata) : {}

export const getTinyRegionMetadata = (metadata: unknown): TinyRegionMetadata =>
  isRecord(metadata) ? (metadata as TinyRegionMetadata) : {}

export const getOptionalString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined

export const getPortPointLinkIds = (
  metadata: TinyPortMetadata,
): Pick<TinyPortMetadata, "prevPortPointId" | "nextPortPointId"> => ({
  prevPortPointId: getOptionalString(metadata.prevPortPointId),
  nextPortPointId: getOptionalString(metadata.nextPortPointId),
})

export const applyMetadataPortPenalties = (loaded: LoadedTinyGraph): number => {
  if (loaded.problem.metadataPortPenaltiesApplied) {
    return 0
  }

  let metadataPortPenaltyCount = 0
  const portPenalty = loaded.problem.portPenalty
    ? new Float64Array(loaded.problem.portPenalty)
    : new Float64Array(loaded.topology.portCount)

  for (let portId = 0; portId < loaded.topology.portCount; portId++) {
    const penalty = Number(
      loaded.topology.portMetadata?.[portId]?.tinyHypergraphPortPenalty,
    )
    if (!Number.isFinite(penalty) || penalty <= 0) {
      continue
    }

    portPenalty[portId] += penalty
    metadataPortPenaltyCount++
  }

  if (metadataPortPenaltyCount > 0) {
    loaded.problem.portPenalty = portPenalty
  }
  loaded.problem.metadataPortPenaltiesApplied = true

  return metadataPortPenaltyCount
}

export const applyPortMetadataPenalties = (
  loaded: LoadedTinyGraph,
): {
  duplicatePortPenaltyCount: number
  crampedPortPenaltyCount: number
} => {
  let duplicatePortPenaltyCount = 0
  let crampedPortPenaltyCount = 0
  const portPenalty = loaded.problem.portPenalty
    ? new Float64Array(loaded.problem.portPenalty)
    : new Float64Array(loaded.topology.portCount)

  for (let portId = 0; portId < loaded.topology.portCount; portId++) {
    const metadata = loaded.topology.portMetadata?.[portId]
    if (getOptionalString(metadata?.duplicatedFromPortId)) {
      portPenalty[portId] += DUPLICATE_PORT_TRAVERSAL_PENALTY
      duplicatePortPenaltyCount++
    }
    if (metadata?.cramped) {
      portPenalty[portId] += CRAMPED_PORT_TRAVERSAL_PENALTY
      crampedPortPenaltyCount++
    }
  }

  if (duplicatePortPenaltyCount > 0 || crampedPortPenaltyCount > 0) {
    loaded.problem.portPenalty = portPenalty
  }

  return { duplicatePortPenaltyCount, crampedPortPenaltyCount }
}

export const applyTerminalRegionNetIds = (loaded: LoadedTinyGraph): void => {
  const netIndexById = new Map<string, number>()

  for (let routeId = 0; routeId < loaded.problem.routeNet.length; routeId++) {
    const routeMetadata = loaded.problem.routeMetadata?.[routeId]
    const netId = getOptionalString(
      routeMetadata?.mutuallyConnectedNetworkId ?? routeMetadata?.connectionId,
    )
    if (netId) {
      netIndexById.set(netId, loaded.problem.routeNet[routeId]!)
    }
  }

  for (
    let regionIndex = 0;
    regionIndex < loaded.problem.regionNetId.length;
    regionIndex++
  ) {
    const terminalNetId = getOptionalString(
      loaded.topology.regionMetadata?.[regionIndex]?._tinyTerminalNetId,
    )
    if (!terminalNetId) {
      continue
    }

    const netIndex = netIndexById.get(terminalNetId)
    if (netIndex !== undefined) {
      loaded.problem.regionNetId[regionIndex] = netIndex
    }
  }
}
