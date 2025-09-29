import { UnravelSectionSolver } from "lib/solvers/UnravelSolver/UnravelSectionSolver"
import UnravelSectionDebugger from "lib/testing/UnravelSectionDebugger"
import unravel3 from "examples/legacy/assets/unravel3.json"
import { getDedupedSegments } from "lib/solvers/UnravelSolver/getDedupedSegments"
import { CapacityMeshNode, CapacityMeshNodeId } from "lib/types"
import { SegmentId } from "lib/solvers/UnravelSolver/types"

export default function Unravel3() {
  return (
    <UnravelSectionDebugger
      createSolver={() => {
        const dedupedSegments = getDedupedSegments(unravel3.assignedSegments)
        const nodeMap: Map<CapacityMeshNodeId, CapacityMeshNode> = new Map()
        for (const node of unravel3.nodes) {
          nodeMap.set(node.capacityMeshNodeId, node as CapacityMeshNode)
        }

        const nodeIdToSegmentIds = new Map<CapacityMeshNodeId, SegmentId[]>()
        const segmentIdToNodeIds = new Map<SegmentId, CapacityMeshNodeId[]>()

        for (const segment of unravel3.assignedSegments) {
          segmentIdToNodeIds.set(segment.nodePortSegmentId!, [
            ...(segmentIdToNodeIds.get(segment.nodePortSegmentId!) ?? []),
            segment.capacityMeshNodeId,
          ])
          nodeIdToSegmentIds.set(segment.capacityMeshNodeId, [
            ...(nodeIdToSegmentIds.get(segment.capacityMeshNodeId) ?? []),
            segment.nodePortSegmentId!,
          ])
        }

        return new UnravelSectionSolver({
          dedupedSegments,
          nodeMap,
          rootNodeId: "cn48",
          nodeIdToSegmentIds,
          segmentIdToNodeIds,
          colorMap: unravel3.colorMap,
        })
      }}
    />
  )
}
