import { Point, Polygon, Segment } from "@flatten-js/core"
import type { AnyCircuitElement } from "circuit-json"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { SimplifiedPcbTrace } from "lib/types"
import RBush from "rbush"
import { compileTraceClearanceObstacle } from "./autorouting-drc/createTraceObstacleClearanceEvaluator"

type Copper = {
  order: number
  id: string
  net: string
  layer: string
  connectionName?: string
  base: Point | Segment | Polygon
  radius: number
  minX: number
  minY: number
  maxX: number
  maxY: number
}
type Gap = {
  left: Copper
  right: Copper
  gap: number
  path: Segment
}
type Options = {
  circuitJson: AnyCircuitElement[]
  traces: SimplifiedPcbTrace[]
  connMap: ConnectivityMap
  minimumClearance: number
  traceWidth: number
  /** Must reject proposals that violate foreign copper, holes or keepouts. */
  validate: (bridges: SimplifiedPcbTrace[]) => void
}

const getCopperDistance = (
  left: Copper,
  right: Copper,
): Pick<Gap, "gap" | "path"> => {
  let [distance, path] = left.base.distanceTo(right.base)
  // Flatten measures boundary distance for contained shapes, whereas copper
  // distance is zero when one filled polygon contains the other shape.
  for (const [polygon, other] of [
    [left, right],
    [right, left],
  ]) {
    if (!(polygon.base instanceof Polygon)) continue
    const points =
      other.base instanceof Point
        ? [other.base]
        : other.base instanceof Segment
          ? [other.base.start, other.base.end]
          : other.base.vertices
    if (
      points.some(
        (point) =>
          polygon.base instanceof Polygon && polygon.base.contains(point),
      )
    )
      distance = 0
  }
  return { gap: distance - left.radius - right.radius, path }
}

/**
 * Electrical DRC exempts same-net copper. Fabrication still cannot resolve a
 * sub-clearance slit between separate copper islands on the same layer. Join
 * those islands with short, validated copper, without moving existing routes.
 * Connectivity on another layer must not hide a physical slit on this layer.
 */
export const getSameNetCopperGapBridges = ({
  circuitJson,
  traces,
  connMap,
  minimumClearance,
  traceWidth,
  validate,
}: Options): SimplifiedPcbTrace[] => {
  if (!(minimumClearance > 0) || !(traceWidth > 0)) {
    throw new Error("Same-net gap repair requires positive clearance and width")
  }
  const byTrace = new Map(traces.map((trace) => [trace.pcb_trace_id, trace]))
  const copper: Copper[] = []
  const parents: number[] = []
  const index = new RBush<Copper>()
  const gaps: Gap[] = []
  const root = (i: number): number => {
    let ancestor = i
    while (parents[ancestor] !== ancestor) ancestor = parents[ancestor]
    while (parents[i] !== i) {
      const next = parents[i]
      parents[i] = ancestor
      i = next
    }
    return ancestor
  }
  const addCopper = (
    base: Copper["base"],
    radius: number,
    metadata: Pick<Copper, "id" | "net" | "layer" | "connectionName">,
  ): Copper => {
    const box = base.box
    const item = {
      ...metadata,
      base,
      radius,
      order: copper.length,
      minX: box.xmin - radius,
      minY: box.ymin - radius,
      maxX: box.xmax + radius,
      maxY: box.ymax + radius,
    }
    parents.push(item.order)
    copper.push(item)
    return item
  }
  for (const element of circuitJson) {
    if (element.type === "pcb_trace") {
      const trace = byTrace.get(element.pcb_trace_id)
      if (!trace)
        throw new Error(`Missing routed copper ${element.pcb_trace_id}`)
      const net = connMap.getNetConnectedToId(element.pcb_trace_id)
      if (!net)
        throw new Error(`Missing net for routed copper ${element.pcb_trace_id}`)
      for (let i = 1; i < element.route.length; i++) {
        const a = element.route[i - 1],
          b = element.route[i]
        if (
          a.route_type !== "wire" ||
          b.route_type !== "wire" ||
          a.layer !== b.layer
        )
          continue
        const start = new Point(a.x, a.y),
          end = new Point(b.x, b.y)
        addCopper(
          start.equalTo(end) ? start : new Segment(start, end),
          a.width / 2,
          {
            id: element.pcb_trace_id,
            net,
            layer: a.layer,
            connectionName: trace.connection_name,
          },
        )
      }
    } else if (
      element.type === "pcb_smtpad" ||
      element.type === "pcb_plated_hole" ||
      element.type === "pcb_via"
    ) {
      const compiled = compileTraceClearanceObstacle(element, 0)
      const net = connMap.getNetConnectedToId(compiled.id)
      // Unconnected mechanical or unused pads have no electrical owner.
      if (!net) continue
      const shape = compiled.shape
      let base: Copper["base"], radius: number
      if (shape.kind === "circle") {
        base = new Point(shape.center.x, shape.center.y)
        radius = shape.radius
      } else if (shape.kind === "capsule") {
        const start = new Point(shape.start.x, shape.start.y),
          end = new Point(shape.end.x, shape.end.y)
        base = start.equalTo(end) ? start : new Segment(start, end)
        radius = shape.radius
      } else {
        base = new Polygon(
          shape.points.map((point) => new Point(point.x, point.y)),
        )
        radius = shape.radius ?? 0
      }
      const owner =
        element.type === "pcb_via"
          ? byTrace.get(element.pcb_trace_id ?? "")
          : undefined
      for (const layer of compiled.layers) {
        addCopper(base, radius, {
          id: compiled.id,
          net,
          layer,
          connectionName: owner?.connection_name,
        })
      }
    }
  }
  index.load(copper)
  const inspectNeighbors = (left: Copper, initial: boolean): void => {
    const neighbors = index.search({
      minX: left.minX - minimumClearance,
      minY: left.minY - minimumClearance,
      maxX: left.maxX + minimumClearance,
      maxY: left.maxY + minimumClearance,
    })
    for (const right of neighbors) {
      if (
        (initial && right.order <= left.order) ||
        right.layer !== left.layer ||
        right.net !== left.net
      )
        continue
      const nearest = getCopperDistance(left, right)
      // Zero-area tangency does not establish a manufacturable copper join.
      if (nearest.gap < -1e-7) parents[root(left.order)] = root(right.order)
      else if (
        nearest.gap < minimumClearance - 1e-6 &&
        (left.connectionName || right.connectionName)
      ) {
        gaps.push({ left, right, ...nearest })
      }
    }
  }
  for (const item of copper) inspectNeighbors(item, true)
  const bridges: SimplifiedPcbTrace[] = []
  const usedIds = new Set(byTrace.keys())
  while (gaps.length) {
    gaps.sort(
      (a, b) =>
        a.gap - b.gap ||
        a.left.order - b.left.order ||
        a.right.order - b.right.order,
    )
    const candidate = gaps.shift()!
    const { left, right, path } = candidate
    if (root(left.order) === root(right.order)) continue
    const connectionName = left.connectionName ?? right.connectionName
    if (!connectionName)
      throw new Error("Same-net gap has no routed electrical owner")
    let id = `same_net_gap_bridge_${bridges.length}`
    while (usedIds.has(id)) id += "_"
    const bridge: SimplifiedPcbTrace = {
      type: "pcb_trace",
      pcb_trace_id: id,
      connection_name: connectionName,
      route: [path.start, path.end].map((point) => ({
        route_type: "wire",
        x: point.x,
        y: point.y,
        width: traceWidth,
        layer: left.layer,
      })),
    }
    validate([...bridges, bridge])
    usedIds.add(id)
    bridges.push(bridge)
    parents[root(left.order)] = root(right.order)
    const item = addCopper(path, traceWidth / 2, {
      id,
      net: left.net,
      layer: left.layer,
      connectionName,
    })
    parents[item.order] = root(left.order)
    // A new bridge can itself approach a third island; include it in the same
    // repair pass rather than leaving another sub-clearance gap behind.
    inspectNeighbors(item, false)
    index.insert(item)
  }
  return bridges
}
