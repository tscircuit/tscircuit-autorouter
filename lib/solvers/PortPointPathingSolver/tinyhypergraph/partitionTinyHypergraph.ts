import type { SerializedHyperGraph } from "@tscircuit/hypergraph"

type TinyConnection = NonNullable<SerializedHyperGraph["connections"]>[number]
type SpatialNet = { net: string; connections: TinyConnection[]; x: number; y: number }

/** Assign nearby nets to balanced worker groups while preserving the full topology. */
export function partitionTinyHypergraph(graph: SerializedHyperGraph): SerializedHyperGraph[] {
  const connections = graph.connections ?? []
  if (connections.length < 32) return []
  const regionById = new Map(graph.regions.map((region) => [region.regionId, region]))
  const netGroups = new Map<string, SpatialNet>()
  const originalNetIndex = new Map<string, number>()
  for (const connection of connections) {
    const net = connection.mutuallyConnectedNetworkId ?? connection.connectionId
    if (!originalNetIndex.has(net)) originalNetIndex.set(net, originalNetIndex.size)
    const start = regionById.get(connection.startRegionId)?.d?.center
    const end = regionById.get(connection.endRegionId)?.d?.center
    if (!start || !end || !Number.isFinite(start.x) || !Number.isFinite(start.y) || !Number.isFinite(end.x) || !Number.isFinite(end.y)) {
      throw new Error(`Spatial routing requires endpoint region centers for ${connection.connectionId}`)
    }
    const group = netGroups.get(net) ?? { net, connections: [], x: 0, y: 0 }
    group.connections.push(connection)
    group.x += (start.x + end.x) / 2
    group.y += (start.y + end.y) / 2
    netGroups.set(net, group)
  }
  const orderedNets = [...netGroups.values()].sort((a, b) =>
    a.x / a.connections.length - b.x / b.connections.length ||
    a.y / a.connections.length - b.y / b.connections.length,
  )
  const netPartition = new Map<string, number>()
  const targetSize = Math.ceil(connections.length / 4)
  let groupIndex = 0
  let groupSize = 0
  for (const group of orderedNets) {
    if (groupIndex < 3 && groupSize >= targetSize) {
      groupIndex++
      groupSize = 0
    }
    netPartition.set(group.net, groupIndex)
    groupSize += group.connections.length
  }
  const partitions: SerializedHyperGraph[] = []
  for (let partition = 0; partition < 4; partition++) {
    const selected = connections.filter((connection) => netPartition.get(connection.mutuallyConnectedNetworkId ?? connection.connectionId) === partition)
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
    const keepRegion = new Set(graph.regions.filter((region) => !region.d?._tinyTerminal || terminalIds.has(region.regionId)).map((region) => region.regionId))
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
