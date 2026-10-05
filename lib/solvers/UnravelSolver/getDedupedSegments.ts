import { NodePortSegment } from "lib/types/capacity-edges-to-port-segments-types"
import { SegmentWithAssignedPoints } from "../CapacityMeshSolver/CapacitySegmentToPointSolver"

/**
 * Deduplicates segments with the same start and end points.
 * Assigns a unique ID to each unique segment and ensures all segments with the same
 * start/end points share the same ID.
 * @param assignedSegments The segments to deduplicate
 * @returns Deduplicated segments with unique IDs
 */
export const getDedupedSegments = (
  assignedSegments: NodePortSegment[],
): SegmentWithAssignedPoints[] => {
  const dedupedSegments: SegmentWithAssignedPoints[] = []
  type SegKey = `${number}-${number}-${number}-${number}-${string}`
  const dedupedSegPointMap: Map<SegKey, NodePortSegment> = new Map()
  let highestSegmentId = -1

  for (const seg of assignedSegments) {
    // Check if there's another segment with the same start and end and availableZ
    const segKey: SegKey = `${seg.start.x}-${seg.start.y}-${seg.end.x}-${seg.end.y}-${seg.availableZ.join(",")}`
    const existingSeg = dedupedSegPointMap.get(segKey)

    if (!existingSeg) {
      highestSegmentId++
      seg.nodePortSegmentId = `SEG${highestSegmentId}`
      dedupedSegPointMap.set(segKey, seg)
      dedupedSegments.push(seg)
      continue
    }

    seg.nodePortSegmentId = existingSeg.nodePortSegmentId
  }

  return dedupedSegments
}
