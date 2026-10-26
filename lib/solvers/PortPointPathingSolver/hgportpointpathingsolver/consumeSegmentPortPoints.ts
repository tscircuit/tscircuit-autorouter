import type { SegmentPortPoint, SharedEdgeSegment } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"

/** Consume owned intermediate segments in their original order. Input SRJ is untouched. */
export function* consumeSegmentPortPoints(
  segments: Array<SharedEdgeSegment | undefined>,
): Generator<SegmentPortPoint> {
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index]
    if (!segment) throw new Error("Graph construction segment was already consumed")
    segments[index] = undefined
    for (const point of segment.portPoints) yield point
  }
  segments.length = 0
}
