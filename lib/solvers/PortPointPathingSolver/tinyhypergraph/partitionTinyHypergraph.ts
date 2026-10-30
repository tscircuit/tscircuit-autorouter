import type { SerializedHyperGraph } from "@tscircuit/hypergraph"

/** Restrict worker routes to disjoint regions so their assignments can be merged. */
export function partitionTinyHypergraph(graph: SerializedHyperGraph): SerializedHyperGraph[] {
  const connections = graph.connections ?? []
  const regions = graph.regions.filter((region) => !region.d?._tinyTerminal)
  if (regions.length === 0 || connections.length < 32) return []
  const xs = regions.map((region) => Number(region.d?.center?.x))
  const ys = regions.map((region) => Number(region.d?.center?.y))
  if (xs.some((value) => !Number.isFinite(value)) || ys.some((value) => !Number.isFinite(value))) {
    throw new Error("Spatial routing requires region centers")
  }
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2
  const centerY = (Math.min(...ys) + Math.max(...ys)) / 2
  const regionById = new Map(graph.regions.map((region) => [region.regionId, region]))
  const regionPartition = new Map<string, number>()
  for (const region of regions) {
    regionPartition.set(region.regionId, (Number(region.d?.center?.x) >= centerX ? 1 : 0) + (Number(region.d?.center?.y) >= centerY ? 2 : 0))
  }
  for (const port of graph.ports) {
    const first = regionById.get(port.region1Id)
    const second = regionById.get(port.region2Id)
    if (first?.d?._tinyTerminal && second && regionPartition.has(second.regionId)) {
      regionPartition.set(first.regionId, regionPartition.get(second.regionId)!)
    } else if (second?.d?._tinyTerminal && first && regionPartition.has(first.regionId)) {
      regionPartition.set(second.regionId, regionPartition.get(first.regionId)!)
    }
  }
  const originalNetIndex = new Map<string, number>()
  for (const connection of connections) {
    const net = connection.mutuallyConnectedNetworkId ?? connection.connectionId
    if (!originalNetIndex.has(net)) originalNetIndex.set(net, originalNetIndex.size)
  }
  const partitions: SerializedHyperGraph[] = []
  for (let partition = 0; partition < 4; partition++) {
    const selected = connections.filter((connection) => regionPartition.get(connection.startRegionId) === partition && regionPartition.get(connection.endRegionId) === partition)
    if (selected.length === 0) continue
    const selectedIds = new Set(selected.map((connection) => connection.connectionId))
    const localNetIndex = new Map<string, number>()
    for (const connection of selected) {
      const net = connection.mutuallyConnectedNetworkId ?? connection.connectionId
      if (!localNetIndex.has(net)) localNetIndex.set(net, localNetIndex.size)
    }
    const remappedNetIndex = new Map<number, number>()
    for (const [net, globalId] of originalNetIndex) {
      remappedNetIndex.set(globalId, localNetIndex.get(net) ?? localNetIndex.size + globalId)
    }
    const terminalIds = new Set(selected.flatMap((connection) => [`tiny-terminal:start-region:${connection.connectionId}`, `tiny-terminal:end-region:${connection.connectionId}`]))
    const keepRegion = new Set(graph.regions.filter((region) => {
      if (regionPartition.get(region.regionId) !== partition) return false
      if (!region.d?._tinyTerminal) return true
      return terminalIds.has(region.regionId)
    }).map((region) => region.regionId))
    const ports = graph.ports.filter((port) => keepRegion.has(port.region1Id) && keepRegion.has(port.region2Id))
    const portIds = new Set(ports.map((port) => port.portId))
    const partitionRegions = graph.regions.filter((region) => keepRegion.has(region.regionId)).map((region) => ({
      ...region,
      pointIds: region.pointIds.filter((pointId) => portIds.has(pointId)),
      d: typeof region.d?.netId === "number" && region.d.netId >= 0 ? { ...region.d, netId: remappedNetIndex.get(region.d.netId) ?? localNetIndex.size + region.d.netId } : region.d,
    }))
    partitions.push({
      regions: partitionRegions,
      ports,
      connections: selected,
      solvedRoutes: (graph.solvedRoutes ?? []).filter((route) => selectedIds.has(route.connection.connectionId)),
    })
  }
  return partitions
}
