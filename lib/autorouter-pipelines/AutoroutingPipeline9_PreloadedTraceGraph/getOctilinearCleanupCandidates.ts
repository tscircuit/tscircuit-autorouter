import { isWithinTraceCleanupCorridor } from "./isWithinTraceCleanupCorridor"
import { calculate45DegreePaths } from "@tscircuit/trace-simplification-solver"
import type { SimplifiedPcbTrace } from "lib/types"

type WirePoint = Extract<
  SimplifiedPcbTrace["route"][number],
  { route_type: "wire" }
>
const GEOMETRY_TOLERANCE = 1e-9
// Bound local search independently of the total number of route bends.
const MAX_CLEANUP_WINDOW_POINTS = 8
// Maximum distance stretch when replacing a straight line with 0/45/90° segments.
const OCTILINEAR_STRETCH = Math.sqrt(4 - 2 * Math.SQRT2)

const removeCollinearPoints = (points: WirePoint[]): WirePoint[] => {
  const output: WirePoint[] = []
  for (const point of points) {
    while (output.length >= 2) {
      const a = output.at(-2)!
      const b = output.at(-1)!
      const cross =
        (b.x - a.x) * (point.y - b.y) - (b.y - a.y) * (point.x - b.x)
      const dot = (b.x - a.x) * (point.x - b.x) + (b.y - a.y) * (point.y - b.y)
      if (
        Math.abs(cross) > GEOMETRY_TOLERANCE ||
        dot < 0 ||
        b.start_pcb_port_id ||
        b.end_pcb_port_id
      )
        break
      output.pop()
    }
    output.push(point)
  }
  return output
}

const getLength = (points: WirePoint[]): number =>
  points
    .slice(1)
    .reduce(
      (length, point, index) =>
        length +
        Math.hypot(point.x - points[index]!.x, point.y - points[index]!.y),
      0,
    )

const getTraceLength = (trace: SimplifiedPcbTrace): number =>
  trace.route.slice(1).reduce((length, point, index) => {
    const previous = trace.route[index]!
    if (
      point.route_type !== "wire" ||
      previous.route_type !== "wire" ||
      point.layer !== previous.layer
    )
      return length
    return length + Math.hypot(point.x - previous.x, point.y - previous.y)
  }, 0)

/** Retains a corridor waypoint while replacing surrounding jogs with 45° approaches. */
export function* getOctilinearCleanupCandidates(
  trace: SimplifiedPcbTrace,
  originalTrace: SimplifiedPcbTrace,
): Generator<SimplifiedPcbTrace> {
  const maximumTraceLength = getTraceLength(originalTrace) * OCTILINEAR_STRETCH
  for (let spanStart = 0; spanStart < trace.route.length; spanStart++) {
    const first = trace.route[spanStart]!
    if (first.route_type !== "wire") continue
    const span = [first]
    let spanEnd = spanStart + 1
    for (; spanEnd < trace.route.length; spanEnd++) {
      const point = trace.route[spanEnd]!
      if (
        point.route_type !== "wire" ||
        point.layer !== first.layer ||
        point.width !== first.width
      )
        break
      span.push(point)
      if (point.start_pcb_port_id || point.end_pcb_port_id) {
        spanEnd++
        break
      }
    }
    const points = removeCollinearPoints(span)
    for (
      let size = Math.min(points.length, MAX_CLEANUP_WINDOW_POINTS);
      size >= 4;
      size--
    ) {
      for (
        let startIndex = 0;
        startIndex + size <= points.length;
        startIndex++
      ) {
        const endIndex = startIndex + size - 1
        const start = points[startIndex]!
        const end = points[endIndex]!
        const hasAngledJog = points
          .slice(startIndex + 1, endIndex + 1)
          .some((point, index) => {
            const previous = points[startIndex + index]!
            const dx = Math.abs(point.x - previous.x)
            const dy = Math.abs(point.y - previous.y)
            return Math.min(dx, dy, Math.abs(dx - dy)) > GEOMETRY_TOLERANCE
          })
        if (!hasAngledJog) continue
        const maximumLength =
          getLength(points.slice(startIndex, endIndex + 1)) * OCTILINEAR_STRETCH
        for (
          let anchorIndex = startIndex + 1;
          anchorIndex < endIndex;
          anchorIndex++
        ) {
          const anchor = points[anchorIndex]!
          for (const before of calculate45DegreePaths(start, anchor)) {
            for (const after of calculate45DegreePaths(anchor, end)) {
              const path = removeCollinearPoints([
                start,
                ...[...before.slice(1), ...after.slice(1, -1)].map(
                  (point): WirePoint => ({
                    route_type: "wire",
                    x: point.x,
                    y: point.y,
                    layer: first.layer,
                    width: first.width,
                  }),
                ),
                end,
              ])
              if (path.length >= size || getLength(path) > maximumLength)
                continue
              if (!isWithinTraceCleanupCorridor(path, originalTrace)) continue
              const candidate: SimplifiedPcbTrace = {
                ...trace,
                route: [
                  ...trace.route.slice(0, spanStart),
                  ...points.slice(0, startIndex),
                  ...path,
                  ...points.slice(endIndex + 1),
                  ...trace.route.slice(spanEnd),
                ],
              }
              if (getTraceLength(candidate) <= maximumTraceLength)
                yield candidate
            }
          }
        }
      }
    }
    spanStart = spanEnd - 1
  }
}
