import type {
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"

export type Pipeline9FlexibleBoundaryStats = {
  originalNodeCount: number
  candidatePairCount: number
  mergedPairCount: number
  removedPortCount: number
  mergedNodeIds: string[]
}

type Seam = {
  axis: "x" | "y"
  coordinate: number
  min: number
  max: number
}

type Candidate = {
  a: number
  b: number
  node: NodeWithPortPoints
  removedPortCount: number
}

type PhysicalTerminal = Pick<PortPoint, "x" | "y" | "z">

const EPSILON = 1e-8

const getPortKey = (point: PortPoint): string | undefined => {
  if (point.portPointId === undefined) {
    return undefined
  }
  const identity = [point.connectionName, point.portPointId]
  return JSON.stringify(identity)
}

const samePort = (a: PortPoint, b: PortPoint): boolean => {
  return (
    getPortKey(a) === getPortKey(b) &&
    a.x === b.x &&
    a.y === b.y &&
    a.z === b.z &&
    a.rootConnectionName === b.rootConnectionName &&
    a.pcb_port_id === b.pcb_port_id
  )
}

const getRectangularSeam = (
  a: NodeWithPortPoints,
  b: NodeWithPortPoints,
): Seam | undefined => {
  const alignedY = a.center.y === b.center.y && a.height === b.height
  const alignedX = a.center.x === b.center.x && a.width === b.width
  if (
    alignedY &&
    Math.abs(Math.abs(a.center.x - b.center.x) - (a.width + b.width) / 2) <
      EPSILON
  ) {
    return {
      axis: "x",
      coordinate:
        a.center.x < b.center.x
          ? a.center.x + a.width / 2
          : b.center.x + b.width / 2,
      min: a.center.y - a.height / 2,
      max: a.center.y + a.height / 2,
    }
  }
  if (
    alignedX &&
    Math.abs(Math.abs(a.center.y - b.center.y) - (a.height + b.height) / 2) <
      EPSILON
  ) {
    return {
      axis: "y",
      coordinate:
        a.center.y < b.center.y
          ? a.center.y + a.height / 2
          : b.center.y + b.height / 2,
      min: a.center.x - a.width / 2,
      max: a.center.x + a.width / 2,
    }
  }
  return undefined
}

const getMergedNode = ({
  a,
  b,
  owners,
  physicalTerminals,
}: {
  a: NodeWithPortPoints
  b: NodeWithPortPoints
  owners: Map<string, Set<string>>
  physicalTerminals: readonly PhysicalTerminal[]
}): NodeWithPortPoints | undefined => {
  const seam = getRectangularSeam(a, b)
  if (!seam || !a.availableZ || !b.availableZ) return undefined
  const layersA = [...a.availableZ].sort((x, y) => x - y)
  const layersB = [...b.availableZ].sort((x, y) => x - y)
  if (JSON.stringify(layersA) !== JSON.stringify(layersB)) return undefined
  if (!a.portPointsInPairs || !b.portPointsInPairs) return undefined

  const internal = new Set<string>()
  const bPorts = new Map(
    b.portPoints.map((point) => [getPortKey(point), point]),
  )
  for (const node of [a, b]) {
    const keys = new Set<string>()
    for (const point of node.portPoints) {
      const key = getPortKey(point)
      if (key === undefined || keys.has(key)) return undefined
      keys.add(key)
      const along = seam.axis === "x" ? point.y : point.x
      const across = seam.axis === "x" ? point.x : point.y
      if (Math.abs(across - seam.coordinate) >= EPSILON) continue
      // Corner contacts remain on the union's outer boundary and are not
      // eligible for this pilot's two-owner directed splice.
      if (along <= seam.min + EPSILON || along >= seam.max - EPSILON) {
        return undefined
      }
      // Physical terminals may have no PCB label. Their original coordinates
      // and layers must remain fixed even when the port otherwise looks shared.
      if (
        point.pcb_port_id !== undefined ||
        owners.get(point.portPointId!)?.size !== 2 ||
        physicalTerminals.some(
          (terminal) =>
            terminal.z === point.z &&
            Math.abs(terminal.x - point.x) < EPSILON &&
            Math.abs(terminal.y - point.y) < EPSILON,
        )
      ) {
        return undefined
      }
      const other =
        node === a
          ? bPorts.get(key)
          : a.portPoints.find((port) => getPortKey(port) === key)
      if (!other || !samePort(point, other)) return undefined
      internal.add(key)
    }
    const flattened = node.portPointsInPairs!.flat()
    if (flattened.length !== node.portPoints.length) return undefined
    if (new Set(flattened.map(getPortKey)).size !== flattened.length) {
      return undefined
    }
    if (
      flattened.some(
        (point) => !node.portPoints.some((port) => samePort(point, port)),
      )
    )
      return undefined
  }
  // A single uncoupled crossing has no ordering freedom to recover. Keep the
  // first pilot focused on seams that constrain multiple independent routes.
  const internalConnections = new Set(
    a.portPoints
      .filter((point) => internal.has(getPortKey(point)!))
      .map((point) => point.connectionName),
  )
  if (internalConnections.size < 2) return undefined

  const byConnection = new Map<string, [PortPoint, PortPoint][]>()
  for (const pair of [...a.portPointsInPairs, ...b.portPointsInPairs]) {
    if (pair[0].connectionName !== pair[1].connectionName) return undefined
    const pairs = byConnection.get(pair[0].connectionName) ?? []
    pairs.push(pair)
    byConnection.set(pair[0].connectionName, pairs)
  }
  const mergedPairs: [PortPoint, PortPoint][] = []
  for (const pairs of byConnection.values()) {
    const starts = pairs.filter(([start]) => !internal.has(getPortKey(start)!))
    const ends = pairs.filter(([, end]) => !internal.has(getPortKey(end)!))
    if (starts.length !== 1 || ends.length !== 1) return undefined
    const visited = new Set<[PortPoint, PortPoint]>()
    let pair = starts[0]!
    while (true) {
      if (visited.has(pair)) return undefined
      visited.add(pair)
      const key = getPortKey(pair[1])!
      if (!internal.has(key)) break
      const successors = pairs.filter(([start]) => getPortKey(start) === key)
      const predecessors = pairs.filter(([, end]) => getPortKey(end) === key)
      if (successors.length !== 1 || predecessors.length !== 1) return undefined
      pair = successors[0]!
    }
    if (visited.size !== pairs.length || pair !== ends[0]) return undefined
    const start = { ...starts[0]![0] }
    const end = { ...ends[0]![1] }
    start.nextPortPointId = end.portPointId
    end.prevPortPointId = start.portPointId
    mergedPairs.push([start, end])
  }
  const portPoints = mergedPairs.flat()
  // Do not increase the number of simultaneous local endpoint demands beyond
  // the harder original cell; the larger physical search is still counted.
  if (portPoints.length > Math.max(a.portPoints.length, b.portPoints.length)) {
    return undefined
  }
  const minX = Math.min(a.center.x - a.width / 2, b.center.x - b.width / 2)
  const maxX = Math.max(a.center.x + a.width / 2, b.center.x + b.width / 2)
  const minY = Math.min(a.center.y - a.height / 2, b.center.y - b.height / 2)
  const maxY = Math.max(a.center.y + a.height / 2, b.center.y + b.height / 2)
  return {
    capacityMeshNodeId: `flexible-boundary:${JSON.stringify(
      [a.capacityMeshNodeId, b.capacityMeshNodeId].sort(),
    )}`,
    center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    width: maxX - minX,
    height: maxY - minY,
    availableZ: layersA,
    portPoints,
    portPointsInPairs: mergedPairs,
  }
}

/** Remove selected artificial seams, retaining the original physical problem. */
export const coarsenPipeline9OrdinaryNodes = ({
  nodes,
  hasPreloadedTraces,
  physicalTerminals,
  enabled = true,
}: {
  nodes: NodeWithPortPoints[]
  hasPreloadedTraces: boolean
  physicalTerminals: readonly PhysicalTerminal[]
  enabled?: boolean
}): { nodes: NodeWithPortPoints[]; stats: Pipeline9FlexibleBoundaryStats } => {
  const stats: Pipeline9FlexibleBoundaryStats = {
    originalNodeCount: nodes.length,
    candidatePairCount: 0,
    mergedPairCount: 0,
    removedPortCount: 0,
    mergedNodeIds: [],
  }
  if (hasPreloadedTraces || !enabled) return { nodes, stats }
  const owners = new Map<string, Set<string>>()
  const nodeIndexById = new Map<string, number>()
  for (const [index, node] of nodes.entries()) {
    if (nodeIndexById.has(node.capacityMeshNodeId)) {
      throw new Error(
        `Pipeline9 flexible boundary: duplicate node ${node.capacityMeshNodeId}`,
      )
    }
    nodeIndexById.set(node.capacityMeshNodeId, index)
    for (const point of node.portPoints) {
      const key = point.portPointId
      if (key === undefined) continue
      const ids = owners.get(key) ?? new Set<string>()
      ids.add(node.capacityMeshNodeId)
      owners.set(key, ids)
    }
  }
  const candidateKeys = new Set<string>()
  const candidates: Candidate[] = []
  for (const ids of owners.values()) {
    if (ids.size !== 2) continue
    const indexes = [...ids]
      .map((id) => nodeIndexById.get(id)!)
      .sort((a, b) => a - b)
    const key = JSON.stringify(indexes)
    if (candidateKeys.has(key)) continue
    candidateKeys.add(key)
    const a = indexes[0]!
    const b = indexes[1]!
    const node = getMergedNode({
      a: nodes[a]!,
      b: nodes[b]!,
      owners,
      physicalTerminals,
    })
    if (!node) continue
    if (nodeIndexById.has(node.capacityMeshNodeId)) {
      throw new Error(
        `Pipeline9 flexible boundary: merged node ID collision ${node.capacityMeshNodeId}`,
      )
    }
    candidates.push({
      a,
      b,
      node,
      removedPortCount:
        nodes[a]!.portPoints.length +
        nodes[b]!.portPoints.length -
        node.portPoints.length,
    })
  }
  stats.candidatePairCount = candidates.length
  candidates.sort(
    (a, b) => b.removedPortCount - a.removedPortCount || a.a - b.a || a.b - b.b,
  )
  const selected = new Map<number, Candidate>()
  const used = new Set<number>()
  for (const candidate of candidates) {
    if (used.has(candidate.a) || used.has(candidate.b)) continue
    used.add(candidate.a)
    used.add(candidate.b)
    selected.set(candidate.a, candidate)
    stats.mergedPairCount++
    stats.removedPortCount += candidate.removedPortCount
    stats.mergedNodeIds.push(candidate.node.capacityMeshNodeId)
  }
  return {
    nodes: nodes.flatMap((node, index) => {
      const candidate = selected.get(index)
      return candidate ? [candidate.node] : used.has(index) ? [] : [node]
    }),
    stats,
  }
}
