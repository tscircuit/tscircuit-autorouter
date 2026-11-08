import type { SimpleRouteConnection } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"

type Point = HighDensityRoute["route"][number]
type Edge = {
  to: string
  fromPoint: Point
  toPoint: Point
  width: number
  cost: number
}

/** Rejoin a repaired point pair using existing segments, without retaining cut-boundary tails. */
export function stitchPipeline9RepairedFragments({
  routes,
  connections,
  isValid,
}: {
  routes: HighDensityRoute[]
  connections: SimpleRouteConnection[]
  isValid: (candidate: HighDensityRoute[]) => boolean
}): HighDensityRoute[] {
  const groups = new Map<string, HighDensityRoute[]>()
  for (const route of routes) {
    const group = groups.get(route.connectionName) ?? []
    group.push(route)
    groups.set(route.connectionName, group)
  }
  let output = routes
  for (const [name, fragments] of groups) {
    if (fragments.length < 2) continue
    const connection = connections.find((item) => item.name === name)
    const terminals = connection?.pointsToConnect.map(
      (point) => point.pcb_port_id,
    )
    // Net trees, untagged boundary connections, and jumper paths require their
    // full branch topology. This optimization handles tagged physical point pairs.
    if (
      !terminals ||
      terminals.length !== 2 ||
      !terminals[0] ||
      !terminals[1] ||
      terminals[0] === terminals[1]
    )
      continue
    const first = fragments[0]!
    if (
      fragments.some(
        (fragment) =>
          fragment.rootConnectionName !== first.rootConnectionName ||
          fragment.viaDiameter !== first.viaDiameter ||
          (fragment.jumpers?.length ?? 0) > 0 ||
          fragment.route.some((point) => point.toNextSegmentType !== undefined),
      )
    )
      continue
    const tagged = new Set(
      fragments
        .flatMap((fragment) => [
          fragment.startPcbPortId,
          fragment.endPcbPortId,
          ...fragment.route.map((point) => point.pcb_port_id),
        ])
        .filter((id): id is string => id !== undefined),
    )
    if (tagged.size !== 2 || terminals.some((id) => !tagged.has(id!))) continue

    // Sub-nanometre rounding joins floating representations of the same vertex;
    // every emitted segment keeps its original endpoint coordinates and width.
    const key = (point: Point): string =>
      `${point.x.toFixed(7)},${point.y.toFixed(7)},${point.z}`
    const graph = new Map<string, Edge[]>()
    const terminalKeys = new Map<string, Set<string>>()
    for (const fragment of fragments) {
      const points = fragment.route.map((point, index) => ({
        ...point,
        pcb_port_id:
          point.pcb_port_id ??
          (index === 0
            ? fragment.startPcbPortId
            : index === fragment.route.length - 1
              ? fragment.endPcbPortId
              : undefined),
      }))
      for (const point of points) {
        if (!graph.has(key(point))) graph.set(key(point), [])
        if (point.pcb_port_id) {
          const keys = terminalKeys.get(point.pcb_port_id) ?? new Set<string>()
          keys.add(key(point))
          terminalKeys.set(point.pcb_port_id, keys)
        }
      }
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]!,
          b = points[i]!
        const width = a.traceThickness ?? fragment.traceThickness
        const cost = Math.hypot(a.x - b.x, a.y - b.y) + (a.z === b.z ? 0 : 1.6)
        graph
          .get(key(a))!
          .push({ to: key(b), fromPoint: a, toPoint: b, width, cost })
        graph
          .get(key(b))!
          .push({ to: key(a), fromPoint: b, toPoint: a, width, cost })
      }
    }
    if (terminals.some((id) => terminalKeys.get(id!)?.size !== 1)) continue
    const start = [...terminalKeys.get(terminals[0])!][0]!
    const end = [...terminalKeys.get(terminals[1])!][0]!
    const costs = new Map<string, number>([[start, 0]])
    const previous = new Map<string, { from: string; edge: Edge }>()
    const pending = new Set(graph.keys())
    while (pending.size > 0) {
      let nearest: string | undefined
      let cost = Infinity
      for (const candidate of pending) {
        const candidateCost = costs.get(candidate) ?? Infinity
        if (candidateCost < cost) {
          nearest = candidate
          cost = candidateCost
        }
      }
      if (nearest === undefined || nearest === end) break
      pending.delete(nearest)
      for (const edge of graph.get(nearest)!) {
        if (!pending.has(edge.to)) continue
        const nextCost = cost + edge.cost
        if (nextCost < (costs.get(edge.to) ?? Infinity)) {
          costs.set(edge.to, nextCost)
          previous.set(edge.to, { from: nearest, edge })
        }
      }
    }
    // Copper may connect through pad areas rather than shared centre-line
    // vertices. Such networks are outside this exact-segment optimization.
    if (!previous.has(end)) continue
    const edges: Edge[] = []
    for (let cursor = end; cursor !== start; ) {
      const step = previous.get(cursor)!
      edges.push(step.edge)
      cursor = step.from
    }
    edges.reverse()
    const path = edges.map((edge) => ({
      ...edge.fromPoint,
      traceThickness: edge.width,
    }))
    path.push({ ...edges.at(-1)!.toPoint, traceThickness: edges.at(-1)!.width })
    // Two fragments can traverse different layer spans of the same through via.
    // Collapse consecutive coincident transitions to one physical via.
    const route: Point[] = []
    for (const point of path) {
      while (route.length >= 2) {
        const a = route.at(-2)!,
          b = route.at(-1)!
        if (
          Math.hypot(a.x - b.x, a.y - b.y, a.x - point.x, a.y - point.y) >
            1e-7 ||
          a.z === b.z ||
          b.z === point.z
        )
          break
        route.pop()
      }
      const last = route.at(-1)
      if (last && key(last) === key(point)) route[route.length - 1] = point
      else route.push(point)
    }
    const merged: HighDensityRoute = {
      ...first,
      startPcbPortId: terminals[0],
      endPcbPortId: terminals[1],
      route,
      vias: route
        .slice(1)
        .flatMap((point, index) =>
          point.z === route[index]!.z ? [] : [{ x: point.x, y: point.y }],
        ),
      jumpers: [],
    }
    const candidate = output.flatMap((item) =>
      item === first ? [merged] : fragments.includes(item) ? [] : [item],
    )
    // Removing a branch must also preserve contacts with the rest of the board.
    if (isValid(candidate)) output = candidate
  }
  return output
}
