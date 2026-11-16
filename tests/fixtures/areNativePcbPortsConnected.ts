import type { PcbPort, PcbTrace, PcbVia } from "circuit-json"

type SourcePortId = PcbPort["source_port_id"]
type CopperNodeId = number
type CopperPoint = { x: number; y: number; layer: string }
type CopperGraph = {
  points: CopperPoint[]
  adjacent: Set<CopperNodeId>[]
  segments: [CopperNodeId, CopperNodeId][]
}

const COPPER_POSITION_TOLERANCE_MM = 1e-6

function getCopperNode(point: CopperPoint, graph: CopperGraph): CopperNodeId {
  const index = graph.points.findIndex(
    (existing) =>
      existing.layer === point.layer &&
      Math.hypot(existing.x - point.x, existing.y - point.y) <
        COPPER_POSITION_TOLERANCE_MM,
  )
  if (index !== -1) return index
  graph.points.push(point)
  graph.adjacent.push(new Set())
  return graph.points.length - 1
}

function connectCopperNodes(
  [start, end]: [CopperNodeId, CopperNodeId],
  graph: CopperGraph,
): void {
  const startNeighbors = graph.adjacent[start]
  const endNeighbors = graph.adjacent[end]
  if (!startNeighbors || !endNeighbors) {
    throw new Error("Native copper edge references a missing node")
  }
  startNeighbors.add(end)
  endNeighbors.add(start)
}

/** Independent centerline connectivity, including T junctions and via barrels. */
export function areNativePcbPortsConnected({
  sourcePortIds,
  traces,
  ports,
  vias,
}: {
  sourcePortIds: SourcePortId[]
  traces: PcbTrace[]
  ports: Map<SourcePortId, PcbPort>
  vias: PcbVia[]
}): boolean {
  const graph: CopperGraph = { points: [], adjacent: [], segments: [] }
  for (const trace of traces) {
    let previous: CopperNodeId | undefined
    for (const point of trace.route) {
      if (point.route_type === "wire") {
        const current = getCopperNode(point, graph)
        if (
          previous !== undefined &&
          graph.points[previous]!.layer === point.layer
        ) {
          connectCopperNodes([previous, current], graph)
          graph.segments.push([previous, current])
        }
        previous = current
      } else if (point.route_type === "via") {
        const from = getCopperNode({ ...point, layer: point.from_layer }, graph)
        const to = getCopperNode({ ...point, layer: point.to_layer }, graph)
        connectCopperNodes([from, to], graph)
        previous = to
      } else {
        throw new Error("Native DDR connectivity expects wire and via routes")
      }
    }
  }
  const traceIds = new Set(traces.map((trace) => trace.pcb_trace_id))
  for (const via of vias) {
    if (!via.pcb_trace_id || !traceIds.has(via.pcb_trace_id)) continue
    const nodes = via.layers.map((layer) =>
      getCopperNode({ ...via, layer }, graph),
    )
    for (const node of nodes) connectCopperNodes([nodes[0]!, node], graph)
  }
  const terminals = sourcePortIds.map((sourcePortId) => {
    const port = ports.get(sourcePortId)
    if (!port || port.layers.length === 0) {
      throw new Error(`Missing native PCB terminal ${sourcePortId}`)
    }
    const nodes = port.layers.map((layer) =>
      getCopperNode({ ...port, layer }, graph),
    )
    for (const node of nodes) connectCopperNodes([nodes[0]!, node], graph)
    return nodes[0]!
  })
  for (let index = 0; index < graph.points.length; index++) {
    const point = graph.points[index]!
    for (const [start, end] of graph.segments) {
      const a = graph.points[start]!
      const b = graph.points[end]!
      if (point.layer !== a.layer) continue
      const dx = b.x - a.x
      const dy = b.y - a.y
      const lengthSquared = dx * dx + dy * dy
      if (lengthSquared === 0) continue
      const t = Math.max(
        0,
        Math.min(
          1,
          ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared,
        ),
      )
      if (
        Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy) <
        COPPER_POSITION_TOLERANCE_MM
      ) {
        connectCopperNodes([index, start], graph)
      }
    }
  }
  if (terminals.length < 2) {
    throw new Error("Expected a native net with multiple terminals")
  }
  const visited = new Set<CopperNodeId>()
  const pending = [terminals[0]!]
  while (pending.length > 0) {
    const node = pending.pop()!
    if (visited.has(node)) continue
    visited.add(node)
    pending.push(...graph.adjacent[node]!)
  }
  return terminals.every((terminal) => visited.has(terminal))
}
