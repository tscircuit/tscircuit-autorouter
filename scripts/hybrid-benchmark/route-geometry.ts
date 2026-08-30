import type { SimplifiedPcbTrace } from "../../lib/types"

export type HybridBenchmarkRouteGeometry = {
  readonly viaCount: number
  readonly routedLengthMm: number
  readonly bendCount: number
}

export function measureHybridBenchmarkRouteGeometry(
  traces: readonly SimplifiedPcbTrace[],
): HybridBenchmarkRouteGeometry {
  let viaCount = 0
  let routedLengthMm = 0
  let bendCount = 0
  for (const trace of traces) {
    const points = trace.route.flatMap((entry) =>
      "x" in entry && "y" in entry
        ? [{ x: entry.x, y: entry.y, layer: getRouteEntryLayer(entry) }]
        : [],
    )
    viaCount += trace.route.filter((entry) => entry.route_type === "via").length
    for (let pointIndex = 1; pointIndex < points.length; pointIndex += 1) {
      const previous = points[pointIndex - 1]!
      const current = points[pointIndex]!
      if (previous.layer === current.layer) {
        routedLengthMm += Math.hypot(
          current.x - previous.x,
          current.y - previous.y,
        )
      }
    }
    for (let pointIndex = 2; pointIndex < points.length; pointIndex += 1) {
      const first = points[pointIndex - 2]!
      const middle = points[pointIndex - 1]!
      const last = points[pointIndex]!
      const crossProduct =
        (middle.x - first.x) * (last.y - middle.y) -
        (middle.y - first.y) * (last.x - middle.x)
      if (Math.abs(crossProduct) > 1e-9) bendCount += 1
    }
  }
  return Object.freeze({ viaCount, routedLengthMm, bendCount })
}

export function combineHybridBenchmarkRouteGeometry(
  first: HybridBenchmarkRouteGeometry,
  second: HybridBenchmarkRouteGeometry,
): HybridBenchmarkRouteGeometry {
  return Object.freeze({
    viaCount: first.viaCount + second.viaCount,
    routedLengthMm: first.routedLengthMm + second.routedLengthMm,
    bendCount: first.bendCount + second.bendCount,
  })
}

function getRouteEntryLayer(
  entry: SimplifiedPcbTrace["route"][number],
): string {
  if (entry.route_type === "wire" || entry.route_type === "jumper") {
    return entry.layer
  }
  return entry.from_layer
}
