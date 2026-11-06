import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { hasPreloadedTraceSectionMetadata } from "./serializePreloadedTraceAssignments"

type Port = SerializedHyperGraph["ports"][number]
type PortId = Port["portId"]
type RegionId = SerializedHyperGraph["regions"][number]["regionId"]
type ConnectionId = NonNullable<
  SerializedHyperGraph["connections"]
>[number]["connectionId"]
type SolvedRoute = NonNullable<SerializedHyperGraph["solvedRoutes"]>[number]
type Edge = { next: number; port: Port }
type Adjacency = Map<number, Edge[]>
type RegionConnectivity = {
  regions: SerializedHyperGraph["regions"]
  indexById: Map<RegionId, number>
  parents: Int32Array
}
type PortAdjacency = RegionConnectivity & { adjacency: Adjacency }

function findRegionComponent(parents: Int32Array, index: number): number {
  while (parents[index] !== index) {
    parents[index] = parents[parents[index]!]!
    index = parents[index]!
  }
  return index
}

function isPortOnSharedLayer(
  port: Port,
  { regions, indexById }: RegionConnectivity,
): boolean {
  const left = regions[indexById.get(port.region1Id)!]!
  const right = regions[indexById.get(port.region2Id)!]!
  const z = port.d?.z
  return (
    Number.isInteger(z) &&
    left.d?.availableZ?.includes(z) &&
    right.d?.availableZ?.includes(z)
  )
}

function addPortAdjacency(
  port: Port,
  { adjacency, indexById, parents }: PortAdjacency,
): void {
  const left = parents[indexById.get(port.region1Id)!]!
  const right = parents[indexById.get(port.region2Id)!]!
  if (left === right) return
  const from = adjacency.get(left) ?? []
  const to = adjacency.get(right) ?? []
  from.push({ next: right, port })
  to.push({ next: left, port })
  adjacency.set(left, from)
  adjacency.set(right, to)
}

/** Preserve computed owners and virtual terminals before congestion duplication.
 * Each disconnected pair greedily retains a minimum path of existing interfaces.
 * Region-layer connectivity is necessary topology, not a physical via-fit proof.
 */
export function preserveSerializedTerminalConnectivity(
  graph: SerializedHyperGraph,
  getOmittedUnoccupiedPorts: () => Port[],
): SerializedHyperGraph {
  if (
    (graph.connections ?? []).some(hasPreloadedTraceSectionMetadata) ||
    graph.regions.some((region) => (region.assignments?.length ?? 0) > 0) ||
    graph.ports.some(
      (port) =>
        (port.d?._preloadedFixedNetIds?.length ?? 0) > 0 ||
        (port.d?._preloadedTracePortAssignments?.length ?? 0) > 0,
    )
  )
    throw new Error(
      "Unoccupied port candidates cannot be used with preloaded assignments",
    )

  const regions = graph.regions
  const indexById = new Map<RegionId, number>(
    regions.map((region, index) => [region.regionId, index]),
  )
  const portById = new Map<PortId, Port>(
    graph.ports.map((port) => [port.portId, port]),
  )
  const parents = Int32Array.from(regions, (_, index) => index)
  const regionConnectivity: RegionConnectivity = {
    regions,
    indexById,
    parents,
  }
  const owner = regions.map((region) =>
    typeof region.d?.netId === "number" && region.d.netId >= 0
      ? region.d.netId
      : undefined,
  )
  const unrestricted = regions.map(
    (region, index) =>
      !region.d?._containsObstacle && owner[index] === undefined,
  )
  for (const port of graph.ports) {
    if (!isPortOnSharedLayer(port, regionConnectivity)) continue
    const left = indexById.get(port.region1Id)!,
      right = indexById.get(port.region2Id)!
    if (!unrestricted[left] || !unrestricted[right]) continue
    const a = findRegionComponent(parents, left),
      b = findRegionComponent(parents, right)
    if (a !== b) parents[b] = a
  }
  for (let index = 0; index < regions.length; index++)
    parents[index] = findRegionComponent(parents, index)

  const kept: Adjacency = new Map()
  const keptPortAdjacency: PortAdjacency = {
    ...regionConnectivity,
    adjacency: kept,
  }
  for (const port of graph.ports)
    if (isPortOnSharedLayer(port, regionConnectivity))
      addPortAdjacency(port, keptPortAdjacency)
  const solvedByConnection = new Map<ConnectionId, SolvedRoute>(
    graph.solvedRoutes?.map((route) => [route.connection.connectionId, route]),
  )
  const retained = new Set(graph.ports.map((port) => port.portId))
  const restored = new Set<PortId>()
  let candidates: Port[] | undefined
  let all: Adjacency | undefined

  for (const connection of graph.connections ?? []) {
    const anchorPath = solvedByConnection.get(connection.connectionId)?.path
    const terminalPorts = [
      anchorPath?.[0]?.portId,
      anchorPath?.at(-1)?.portId,
    ].map((id) => (typeof id === "string" ? portById.get(id) : undefined))
    const endpoints = terminalPorts.map(
      (port) =>
        port &&
        [port.region1Id, port.region2Id]
          .map((id) => indexById.get(id)!)
          .find((index) => regions[index]!.d?._tinyTerminal === true),
    )
    const [startNode, endNode] = endpoints
    if (startNode === undefined || endNode === undefined)
      throw new Error(
        `Missing virtual terminals for ${connection.connectionId}`,
      )
    const net = owner[startNode]
    if (net === undefined || owner[endNode] !== net)
      throw new Error(
        `Inconsistent terminal ownership for ${connection.connectionId}`,
      )
    const start = parents[startNode]!,
      end = parents[endNode]!
    if (start === end) continue
    const seen = new Set([start]),
      queue = [start]
    for (let index = 0; index < queue.length && !seen.has(end); index++) {
      for (const edge of kept.get(queue[index]!) ?? []) {
        if (
          seen.has(edge.next) ||
          (!unrestricted[edge.next] && owner[edge.next] !== net)
        )
          continue
        seen.add(edge.next)
        queue.push(edge.next)
      }
    }
    if (seen.has(end)) continue

    if (!all) {
      candidates = getOmittedUnoccupiedPorts()
      all = new Map([...kept].map(([index, edges]) => [index, [...edges]]))
      const allPortAdjacency: PortAdjacency = {
        ...regionConnectivity,
        adjacency: all,
      }
      for (const port of candidates) {
        if (retained.has(port.portId))
          throw new Error(`Port candidate already exists: ${port.portId}`)
        if (
          (port.d?._preloadedFixedNetIds?.length ?? 0) > 0 ||
          (port.d?._preloadedTracePortAssignments?.length ?? 0) > 0
        )
          throw new Error(
            "Unoccupied candidate contains a preloaded assignment",
          )
        if (port.d?.cramped && isPortOnSharedLayer(port, regionConnectivity))
          addPortAdjacency(port, allPortAdjacency)
      }
    }
    const distance = new Map<number, number>([[start, 0]])
    const previous = new Map<number, { from: number; port: Port }>()
    const deque = new Map<number, number>([[0, start]])
    let head = 0,
      tail = 1
    while (head < tail) {
      const at = deque.get(head)!
      deque.delete(head++)
      if (at === end) break
      for (const edge of all.get(at) ?? []) {
        if (!unrestricted[edge.next] && owner[edge.next] !== net) continue
        const cost = retained.has(edge.port.portId) ? 0 : 1
        const nextDistance = distance.get(at)! + cost
        if (nextDistance >= (distance.get(edge.next) ?? Infinity)) continue
        distance.set(edge.next, nextDistance)
        previous.set(edge.next, { from: at, port: edge.port })
        if (cost === 0) deque.set(--head, edge.next)
        else deque.set(tail++, edge.next)
      }
    }
    if (!distance.has(end)) continue
    let at = end
    while (at !== start) {
      const step = previous.get(at)
      if (!step)
        throw new Error(
          `Missing existing-interface path for ${connection.connectionId}`,
        )
      if (!retained.has(step.port.portId)) {
        retained.add(step.port.portId)
        restored.add(step.port.portId)
        addPortAdjacency(step.port, keptPortAdjacency)
      }
      at = step.from
    }
  }

  if (restored.size === 0) return graph
  const additions = candidates!.filter((port) => restored.has(port.portId))
  const addedByRegion = new Map<RegionId, PortId[]>()
  for (const port of additions)
    for (const id of [port.region1Id, port.region2Id]) {
      const ids = addedByRegion.get(id) ?? []
      ids.push(port.portId)
      addedByRegion.set(id, ids)
    }
  return {
    ...graph,
    ports: [...graph.ports, ...additions],
    regions: regions.map((region) => {
      const ids = addedByRegion.get(region.regionId)
      return ids
        ? { ...region, pointIds: [...region.pointIds, ...ids] }
        : region
    }),
  }
}
