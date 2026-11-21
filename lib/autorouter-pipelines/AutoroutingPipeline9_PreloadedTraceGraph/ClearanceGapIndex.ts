import { distance, midpoint, type Point } from "@tscircuit/math-utils"
import { RbushIndex } from "lib/data-structures/RbushIndex"
import { PRELOADED_TRACE_TOLERANCE } from "./getPreloadedTracePrimitives"

export type ClearanceGap = { z: number; start: Point; end: Point }

/** Mesh rebuilds can renumber or reverse a boundary. Match the physical span on its copper layer. */
export class ClearanceGapIndex {
  private readonly byCenter = new RbushIndex<ClearanceGap>()
  private readonly indexedGaps: ClearanceGap[] = []

  get gaps(): readonly ClearanceGap[] {
    return this.indexedGaps
  }

  has(gap: ClearanceGap): boolean {
    if (this.indexedGaps.length === 0) return false
    const { x, y } = midpoint(gap.start, gap.end)
    const tolerance = PRELOADED_TRACE_TOLERANCE
    return this.byCenter
      .search(x - tolerance, y - tolerance, x + tolerance, y + tolerance)
      .some(
        (other) =>
          other.z === gap.z &&
          ((distance(gap.start, other.start) <= tolerance &&
            distance(gap.end, other.end) <= tolerance) ||
            (distance(gap.start, other.end) <= tolerance &&
              distance(gap.end, other.start) <= tolerance)),
      )
  }

  add({ start, end, z }: ClearanceGap): void {
    const gap = { start, end, z }
    if (this.has(gap)) return
    const { x, y } = midpoint(gap.start, gap.end)
    this.byCenter.insert(gap, x, y, x, y)
    this.indexedGaps.push(gap)
  }
}
