import type { SimplifiedPcbTrace } from "../../types"

export type PostRoutingMetrics = {
  viaSites: number
  copperLength: number
  bends: number
}

/** Count same-net, same-layer collinear copper once, including shared branches.
 * Line/site keys use 1e-9 mm precision; this is a routing metric, not CAD DRC. */
export function measurePostRoutingMetrics(
  traces: readonly SimplifiedPcbTrace[],
  traceOwners: ReadonlyMap<string, string>,
): PostRoutingMetrics {
  const sites = new Set<string>()
  const lines = new Map<string, [number, number][]>()
  let bends = 0
  for (const trace of traces) {
    const owner = traceOwners.get(trace.connection_name)
    if (!owner)
      throw new Error(`Missing metric owner for ${trace.connection_name}`)
    for (let i = 0; i < trace.route.length; i++) {
      const a = trace.route[i]!
      if (a.route_type === "via") {
        sites.add(JSON.stringify([owner, a.x.toFixed(9), a.y.toFixed(9)]))
        continue
      }
      if (a.route_type !== "wire")
        throw new Error(`Unsupported metric primitive ${a.route_type}`)
      const b = trace.route[i + 1]
      if (b?.route_type !== "wire" || a.layer !== b.layer) continue
      const dx = b.x - a.x,
        dy = b.y - a.y,
        length = Math.hypot(dx, dy)
      if (length < 1e-9) continue
      const sign = dx < -1e-12 || (Math.abs(dx) <= 1e-12 && dy < 0) ? -1 : 1
      const ux = (sign * dx) / length,
        uy = (sign * dy) / length
      const offset = -uy * a.x + ux * a.y
      const key = JSON.stringify([
        owner,
        a.layer,
        ux.toFixed(9),
        uy.toFixed(9),
        offset.toFixed(9),
      ])
      const start = ux * a.x + uy * a.y,
        end = ux * b.x + uy * b.y
      const intervals = lines.get(key) ?? []
      intervals.push([Math.min(start, end), Math.max(start, end)])
      lines.set(key, intervals)
      const c = trace.route[i + 2]
      if (c?.route_type === "wire" && c.layer === a.layer) {
        const ex = c.x - b.x,
          ey = c.y - b.y
        if (
          Math.hypot(ex, ey) > 1e-9 &&
          (Math.abs(dx * ey - dy * ex) > 1e-9 || dx * ex + dy * ey < 0)
        )
          bends++
      }
    }
  }
  let copperLength = 0
  for (const intervals of lines.values()) {
    intervals.sort((a, b) => a[0] - b[0] || a[1] - b[1])
    let start = intervals[0]![0],
      end = intervals[0]![1]
    for (const next of intervals.slice(1)) {
      if (next[0] <= end + 1e-9) end = Math.max(end, next[1])
      else {
        copperLength += end - start
        ;[start, end] = next
      }
    }
    copperLength += end - start
  }
  return { viaSites: sites.size, copperLength, bends }
}
