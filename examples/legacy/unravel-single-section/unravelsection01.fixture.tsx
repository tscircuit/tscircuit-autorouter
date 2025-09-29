import { UnravelSectionSolver } from "lib/solvers/UnravelSolver/UnravelSectionSolver"
import UnravelSectionDebugger from "lib/testing/UnravelSectionDebugger"
import segmentpoint5 from "examples/legacy/assets/segmenttopoint5.json"
import { getDedupedSegments } from "lib/solvers/UnravelSolver/getDedupedSegments"
import { CapacityMeshNode, CapacityMeshNodeId } from "lib/types"
import { SegmentId } from "lib/solvers/UnravelSolver/types"

export default function Unravel1() {
  return (
    <UnravelSectionDebugger
      createSolver={() => {
        const dedupedSegments = getDedupedSegments(
          segmentpoint5.assignedSegments,
        )
        const nodeMap: Map<CapacityMeshNodeId, CapacityMeshNode> = new Map()
        for (const node of segmentpoint5.nodes) {
          nodeMap.set(node.capacityMeshNodeId, node as CapacityMeshNode)
        }

        const nodeIdToSegmentIds = new Map<CapacityMeshNodeId, SegmentId[]>()
        const segmentIdToNodeIds = new Map<SegmentId, CapacityMeshNodeId[]>()

        for (const segment of segmentpoint5.assignedSegments) {
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
          rootNodeId: "cn58",
          nodeIdToSegmentIds,
          segmentIdToNodeIds,
          colorMap: segmentpoint5.colorMap,
        })
      }}
    />
  )
}
