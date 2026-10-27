import type { SerializedHyperGraph } from "@tscircuit/hypergraph"

type Region = SerializedHyperGraph["regions"][number]
type Port = SerializedHyperGraph["ports"][number]
type Connection = NonNullable<SerializedHyperGraph["connections"]>[number]
type SolvedRoute = NonNullable<SerializedHyperGraph["solvedRoutes"]>[number]

export type PartialLayerRegionOptions = {
  layerCount: number
  allowBlindAndBuriedVias?: boolean
}

/** Keeps partial-stack cells planar when all new vias traverse the full board. */
export function splitPartialLayerRegions(
  graph: SerializedHyperGraph,
  options: PartialLayerRegionOptions,
): SerializedHyperGraph {
  if (options.allowBlindAndBuriedVias !== false) return graph
  if (!Number.isInteger(options.layerCount) || options.layerCount < 1) {
    throw new Error("No-blind region splitting requires a valid board layer count")
  }
  const originalIds = new Set(graph.regions.map((region) => region.regionId))
  const idsByLayer = new Map<string, Map<number, string>>()
  const portsById = new Map(graph.ports.map((port) => [port.portId, port]))
  for (const region of graph.regions) {
    const available = region.d?.availableZ
    if (!Array.isArray(available) || available.length === 0 ||
      available.some((z: number) => !Number.isInteger(z) || z < 0 || z >= options.layerCount)) {
      throw new Error(`No-blind region ${region.regionId} has invalid available layers`)
    }
    const layers = [...new Set<number>(available)].sort((a, b) => a - b)
    if (layers.length === 1 || layers.length === options.layerCount) continue
    const mapping = new Map<number, string>()
    for (const z of layers) {
      const id = `${region.regionId}::layer:${z}`
      if (originalIds.has(id)) throw new Error(`No-blind split region ID collision: ${id}`)
      originalIds.add(id)
      mapping.set(z, id)
    }
    idsByLayer.set(region.regionId, mapping)
  }
  if (idsByLayer.size === 0) return graph

  const getPortLayer = (portId: string): number => {
    const port = portsById.get(portId)
    const z = port?.d?.z
    if (!port || typeof z !== "number" || !Number.isInteger(z) || z < 0 || z >= options.layerCount) {
      throw new Error(`No-blind split requires an exact layer for port ${portId}`)
    }
    return z
  }
  const remapRegion = (regionId: string, portId: string, otherPortId?: string): string => {
    const mapping = idsByLayer.get(regionId)
    if (!mapping) return regionId
    const z = getPortLayer(portId)
    if (otherPortId !== undefined && getPortLayer(otherPortId) !== z) {
      throw new Error(`Existing cross-layer path in partial region ${regionId} requires an explicit physical via`)
    }
    const replacement = mapping.get(z)
    if (replacement === undefined) {
      throw new Error(`Port ${portId} layer ${z} is unavailable in region ${regionId}`)
    }
    return replacement
  }
  const solvedById = new Map((graph.solvedRoutes ?? []).map((route) =>
    [route.connection.connectionId, route]))
  const remapConnection = (connection: Connection): Connection => {
    const path = solvedById.get(connection.connectionId)?.path
    const start = path?.[0]?.portId
    const end = path?.[path.length - 1]?.portId
    if ((idsByLayer.has(connection.startRegionId) && start === undefined) ||
      (idsByLayer.has(connection.endRegionId) && end === undefined)) {
      throw new Error(`Connection ${connection.connectionId} needs exact endpoint ports for no-blind splitting`)
    }
    return { ...connection,
      startRegionId: start === undefined ? connection.startRegionId : remapRegion(connection.startRegionId, start),
      endRegionId: end === undefined ? connection.endRegionId : remapRegion(connection.endRegionId, end),
    }
  }
  const regions: Region[] = []
  for (const region of graph.regions) {
    const mapping = idsByLayer.get(region.regionId)
    if (!mapping) { regions.push(region); continue }
    for (const assignment of region.assignments ?? []) {
      remapRegion(region.regionId, assignment.regionPort1Id, assignment.regionPort2Id)
    }
    for (const [z, regionId] of mapping) {
      regions.push({ ...region, regionId,
        pointIds: region.pointIds.filter((id) => getPortLayer(id) === z),
        d: { ...region.d, availableZ: [z], _noBlindOriginalRegionId: region.regionId },
        ...(region.assignments === undefined ? {} : {
          assignments: region.assignments.filter((assignment) => getPortLayer(assignment.regionPort1Id) === z),
        }),
      })
    }
  }
  const ports: Port[] = graph.ports.map((port) => ({ ...port,
    region1Id: remapRegion(port.region1Id, port.portId),
    region2Id: remapRegion(port.region2Id, port.portId),
  }))
  const connections = graph.connections?.map(remapConnection)
  const connectionById = new Map(connections?.map((connection) => [connection.connectionId, connection]))
  const solvedRoutes: SolvedRoute[] | undefined = graph.solvedRoutes?.map((route) => ({ ...route,
    connection: { ...route.connection, ...connectionById.get(route.connection.connectionId) },
    path: route.path.map((candidate, index) => ({ ...candidate,
      ...(candidate.nextRegionId === undefined ? {} : {
        nextRegionId: remapRegion(candidate.nextRegionId, candidate.portId, route.path[index + 1]?.portId),
      }),
      ...(candidate.lastRegionId === undefined ? {} : {
        lastRegionId: remapRegion(candidate.lastRegionId, candidate.portId, route.path[index - 1]?.portId),
      }),
    })),
  }))
  return { ...graph, regions, ports,
    ...(connections === undefined ? {} : { connections }),
    ...(solvedRoutes === undefined ? {} : { solvedRoutes }),
  }
}
