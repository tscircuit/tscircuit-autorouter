import type { PCBTrace, PCBPort, PCBVia, SourceTrace } from "circuit-json"
type SourcePortId = PCBPort["source_port_id"]

export function areTracePortsConnected(trace: SourceTrace, routes: PCBTrace[], ports: Map<SourcePortId, PCBPort>, vias: PCBVia[]): boolean {
  return arePortsConnected(trace.connected_source_port_ids, routes.filter((r) => r.source_trace_id === trace.source_trace_id), ports, vias)
}

/** Routes must already be restricted to the requested electrical net. */
export function arePortsConnected(sourcePortIds: SourcePortId[], routes: PCBTrace[], ports: Map<SourcePortId, PCBPort>, vias: PCBVia[]): boolean {
  const nodes: { x: number; y: number; layer: string }[] = []
  const links: number[][] = []
  const segments: [number, number][] = []
  function node(point: { x: number; y: number; layer: string }): number {
    const found = nodes.findIndex((n) => n.layer === point.layer && Math.hypot(n.x-point.x,n.y-point.y) < 1e-6)
    if (found >= 0) return found
    nodes.push(point); links.push([])
    return nodes.length - 1
  }
  function link(a: number, b: number): void { links[a].push(b); links[b].push(a) }
  for (const route of routes) {
    let previous: number | undefined
    for (const point of route.route) {
      if (point.route_type === "wire") {
        const current = node(point)
        if (previous !== undefined && nodes[previous].layer === point.layer) { link(previous,current); segments.push([previous,current]) }
        previous = current
      } else if (point.route_type === "via") {
        const from = node({ ...point, layer: point.from_layer })
        const to = node({ ...point, layer: point.to_layer })
        if (previous !== undefined && nodes[previous].layer === point.from_layer && Math.hypot(nodes[previous].x-point.x,nodes[previous].y-point.y) < 1e-6) link(previous,from)
        link(from,to); previous = to
      }
    }
  }
  // Route transitions describe which layers the path uses. A manufactured
  // through via can also join a branch on any other layer in its emitted span.
  const routeIds = new Set(routes.map((r) => r.pcb_trace_id))
  for (const via of vias) {
    if (!via.pcb_trace_id || !routeIds.has(via.pcb_trace_id)) continue
    const viaNodes = via.layers.map((layer) => node({ x:via.x,y:via.y,layer }))
    for (const current of viaNodes) link(viaNodes[0],current)
  }
  // Join T junctions at intermediate route vertices as well as endpoints.
  for (let i = 0; i < nodes.length; i++) {
    const point = nodes[i]
    for (const [a,b] of segments) {
      if (point.layer !== nodes[a].layer) continue
      const dx = nodes[b].x-nodes[a].x, dy = nodes[b].y-nodes[a].y
      const t = Math.max(0,Math.min(1,((point.x-nodes[a].x)*dx+(point.y-nodes[a].y)*dy)/(dx*dx+dy*dy || 1)))
      if (Math.hypot(point.x-nodes[a].x-t*dx,point.y-nodes[a].y-t*dy) < 1e-6) link(i,a)
    }
  }
  const terminals: number[] = []
  let missingPort = false
  for (const id of sourcePortIds) {
    const port: any = ports.get(id)
    if (!port) { missingPort = true; continue }
    const portNodes = port.layers.map((layer: string) => node({ ...port, layer }))
    for (const current of portNodes) {
      for (const [a,b] of segments) {
        if (nodes[current].layer !== nodes[a].layer) continue
        const dx = nodes[b].x-nodes[a].x, dy = nodes[b].y-nodes[a].y
        const t = Math.max(0,Math.min(1,((port.x-nodes[a].x)*dx+(port.y-nodes[a].y)*dy)/(dx*dx+dy*dy || 1)))
        if (Math.hypot(port.x-nodes[a].x-t*dx,port.y-nodes[a].y-t*dy) < 1e-6) link(current,a)
      }
      link(portNodes[0],current)
    }
    terminals.push(portNodes[0])
  }
  const visited = new Set<number>(), queue = terminals.length ? [terminals[0]] : []
  while (queue.length) { const current = queue.pop()!; if (visited.has(current)) continue; visited.add(current); queue.push(...links[current]) }
  return routes.length > 0 && !missingPort && terminals.length >= 2 && terminals.every((n) => visited.has(n))
}
