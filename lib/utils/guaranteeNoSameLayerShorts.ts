import type {
  SimplifiedPcbTrace,
  SimplifiedPcbTraces,
} from "lib/types/srj-types"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"

/**
 * A router must never emit a short, but the capacity pipeline models same-layer
 * crossings as via-resolvable *cost* (`calculateCrossingProbabilityOfFailure`),
 * so when the high-density/repair stage can't resolve one it survives into the
 * output as a different-net same-layer overlap (a real short).
 *
 * This is the safety net for those crossings. It resolves a violation the way a
 * human would: keep the trace's copper, run the offending segment on another
 * layer, and transition with a via at each end.
 *
 * It deliberately never truncates the victim trace. Truncating disconnects the
 * connection, which the DRC evaluator reports as a brand new
 * `missing_connection_*` error — trading one DRC failure for another, on a
 * fixture (`bugreport99`) whose short is already present in the pre-power
 * traces and therefore is not a regression. When no alternative layer is free
 * (or the crossing sits where vias are not allowed), the crossing is left as
 * routed for the router itself to fix; the safety net only ever improves the
 * output, never degrades it.
 */

interface WireSeg {
  traceIdx: number
  segIdx: number
  layer: string
  conn: string
  width: number
  a: { x: number; y: number }
  b: { x: number; y: number }
}

type RoutePoint = SimplifiedPcbTrace["route"][number]

type WirePoint = Extract<RoutePoint, { route_type: "wire" }>

export interface SameLayerShortOptions {
  /**
   * Whether a via may be placed at this board point. Pipelines pass `false` for
   * regions with a single available layer, where a via has nowhere to go.
   */
  canPlaceVia?: (point: { x: number; y: number }) => boolean
  /**
   * Copper layers the board actually has. Traces only reveal the layers they
   * use, so a board whose spare layer is still unrouted needs to say so here.
   */
  layerNames?: string[]
}

const VIA_DIAMETER = 0.3
const VIA_HOLE_DIAMETER = 0.2

const wireSegments = (traces: SimplifiedPcbTraces): WireSeg[] => {
  const segs: WireSeg[] = []
  traces.forEach((t, ti) => {
    for (let i = 0; i < t.route.length - 1; i++) {
      const p = t.route[i]
      const q = t.route[i + 1]
      if (p.route_type !== "wire" || q.route_type !== "wire") continue
      if (p.layer !== q.layer) continue
      segs.push({
        traceIdx: ti,
        segIdx: i,
        layer: p.layer,
        conn: t.connection_name,
        width: p.width,
        a: { x: p.x, y: p.y },
        b: { x: q.x, y: q.y },
      })
    }
  })
  return segs
}

/** Copper edge-to-edge gap between two wire segments; negative means overlap. */
const segmentGap = (a: WireSeg, b: WireSeg): number =>
  minimumDistanceBetweenSegments(a.a, a.b, b.a, b.b) - (a.width + b.width) / 2

/** First different-connection same-layer segment pair whose copper edge-to-edge
 *  gap is under `clearance`, or null. connection_name is net-attached
 *  (netConnectionName), so same-net traces share it and are skipped. */
const findViolation = (
  traces: SimplifiedPcbTraces,
  clearance: number,
): { a: WireSeg; b: WireSeg } | null => {
  const segs = wireSegments(traces)
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const a = segs[i]
      const b = segs[j]
      if (a.traceIdx === b.traceIdx) continue
      if (a.layer !== b.layer) continue
      if (a.conn === b.conn) continue
      if (segmentGap(a, b) < clearance) return { a, b }
    }
  }
  return null
}

/** Board routing layers: the layers the caller declares, plus any seen on traces. */
const routingLayers = (
  traces: SimplifiedPcbTraces,
  declaredLayers: string[] = [],
): string[] => {
  const layers = [...declaredLayers]
  for (const trace of traces) {
    for (const point of trace.route) {
      if (point.route_type !== "wire") continue
      if (!layers.includes(point.layer)) layers.push(point.layer)
    }
  }
  return layers
}

/** A wire segment relocated onto `layer`, checked against every other trace. */
const relocationViolates = (
  traces: SimplifiedPcbTraces,
  victim: WireSeg,
  layer: string,
  clearance: number,
): boolean => {
  const moved: WireSeg = { ...victim, layer }
  return wireSegments(traces).some(
    (other) =>
      other.traceIdx !== victim.traceIdx &&
      other.layer === layer &&
      other.conn !== moved.conn &&
      segmentGap(moved, other) < clearance,
  )
}

const via = (
  point: WirePoint,
  fromLayer: string,
  toLayer: string,
): RoutePoint => ({
  route_type: "via",
  x: point.x,
  y: point.y,
  from_layer: fromLayer,
  to_layer: toLayer,
  via_diameter: VIA_DIAMETER,
  via_hole_diameter: VIA_HOLE_DIAMETER,
})

/**
 * Keep the victim trace connected: run the offending segment on `layer` and
 * transition with a via at each end. Returns null when the relocated segment
 * would itself violate, or when either via cannot be placed.
 */
const relocateSegment = (
  traces: SimplifiedPcbTraces,
  victim: WireSeg,
  layer: string,
  clearance: number,
  canPlaceVia: (point: { x: number; y: number }) => boolean,
): SimplifiedPcbTraces | null => {
  const route = traces[victim.traceIdx].route
  const p = route[victim.segIdx]
  const q = route[victim.segIdx + 1]
  if (p.route_type !== "wire" || q.route_type !== "wire") return null
  if (p.layer === layer) return null
  if (!canPlaceVia({ x: p.x, y: p.y }) || !canPlaceVia({ x: q.x, y: q.y })) {
    return null
  }
  const relocatedRoute: RoutePoint[] = [
    ...route.slice(0, victim.segIdx + 1),
    via(p, p.layer, layer),
    { ...p, layer },
    { ...q, layer },
    via(q, layer, q.layer),
    ...route.slice(victim.segIdx + 1),
  ]
  const candidate = traces.map((trace, i) =>
    i === victim.traceIdx ? { ...trace, route: relocatedRoute } : trace,
  )
  if (relocationViolates(candidate, victim, layer, clearance)) return null
  return candidate
}

export const hasSameLayerShort = (
  traces: SimplifiedPcbTraces,
  clearance = 0,
): boolean => findViolation(traces, clearance) !== null

export const guaranteeNoSameLayerShorts = (
  traces: SimplifiedPcbTraces,
  clearance = 0,
  options: SameLayerShortOptions = {},
): SimplifiedPcbTraces => {
  const canPlaceVia = options.canPlaceVia ?? (() => true)
  let out = traces.map((t) => ({ ...t, route: [...t.route] }))
  const maxPasses = wireSegments(out).length + 1
  const layers = routingLayers(out, options.layerNames)
  for (let pass = 0; pass < maxPasses; pass++) {
    const hit = findViolation(out, clearance)
    if (!hit) break
    const lossA = out[hit.a.traceIdx].route.length - 1 - hit.a.segIdx
    const lossB = out[hit.b.traceIdx].route.length - 1 - hit.b.segIdx
    const victims = lossA <= lossB ? [hit.a, hit.b] : [hit.b, hit.a]
    let relocated: SimplifiedPcbTraces | null = null
    for (const victim of victims) {
      for (const layer of layers) {
        if (layer === victim.layer) continue
        relocated = relocateSegment(out, victim, layer, clearance, canPlaceVia)
        if (relocated) break
      }
      if (relocated) break
    }
    if (!relocated) break
    out = relocated
  }
  return out
}
