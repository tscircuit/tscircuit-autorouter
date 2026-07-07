import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"
import type { SimplifiedPcbTraces } from "lib/types/srj-types"

/**
 * A router must never emit a short. The capacity pipeline models same-layer
 * crossings as via-resolvable cost, so when the high-density/repair stage can't
 * actually resolve one it survives into the output as a different-net same-layer
 * overlap (a real short) or a sub-clearance near-miss. Nothing downstream checks
 * for this, so which fixtures come out shorted is effectively non-deterministic.
 *
 * This is the safety net: after routing, if two traces of different connections
 * run closer than `clearance` on the same copper layer (0 gap = a hard short),
 * truncate one at the offending segment so it degrades to an unrouted ratsnest
 * (recoverable) instead of a short / DRC-fail (a broken board). The output is
 * then guaranteed free of different-net same-layer violations, independent of any
 * topology-cost tuning.
 *
 * (Follow-up, left to the maintainers: resolve the crossing with an inserted via
 * instead of truncating, to keep the net routed.)
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
      // centerline distance minus both half-widths = copper edge-to-edge gap
      const gap =
        minimumDistanceBetweenSegments(a.a, a.b, b.a, b.b) -
        (a.width + b.width) / 2
      if (gap < clearance) return { a, b }
    }
  }
  return null
}

export const hasSameLayerShort = (
  traces: SimplifiedPcbTraces,
  clearance = 0,
): boolean => findViolation(traces, clearance) !== null

export const guaranteeNoSameLayerShorts = (
  traces: SimplifiedPcbTraces,
  clearance = 0,
): SimplifiedPcbTraces => {
  const out = traces.map((t) => ({ ...t, route: [...t.route] }))
  // each pass truncates >=1 segment, so this terminates; the cap is a backstop.
  const maxPasses = wireSegments(out).length + 1
  for (let pass = 0; pass < maxPasses; pass++) {
    const hit = findViolation(out, clearance)
    if (!hit) break
    // truncate whichever trace loses fewer route points past the offending seg
    const lossA = out[hit.a.traceIdx].route.length - 1 - hit.a.segIdx
    const lossB = out[hit.b.traceIdx].route.length - 1 - hit.b.segIdx
    const victim = lossA <= lossB ? hit.a : hit.b
    out[victim.traceIdx].route = out[victim.traceIdx].route.slice(
      0,
      victim.segIdx + 1,
    )
  }
  return out
}
