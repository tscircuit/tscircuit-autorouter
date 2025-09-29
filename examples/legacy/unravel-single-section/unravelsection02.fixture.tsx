import { UnravelSectionSolver } from "lib/solvers/UnravelSolver/UnravelSectionSolver"
import UnravelSectionDebugger from "lib/testing/UnravelSectionDebugger"
import unravel2 from "examples/legacy/assets/unravel2.json"
import { getDedupedSegments } from "lib/solvers/UnravelSolver/getDedupedSegments"
import { CapacityMeshNode, CapacityMeshNodeId } from "lib/types"
import { SegmentId } from "lib/solvers/UnravelSolver/types"

export default function Unravel2() {
  return (
    <UnravelSectionDebugger
      createSolver={() => {
        const dedupedSegments = getDedupedSegments(unravel2.assignedSegments)
        const nodeMap: Map<CapacityMeshNodeId, CapacityMeshNode> = new Map()
        for (const node of unravel2.nodes) {
          nodeMap.set(node.capacityMeshNodeId, node as CapacityMeshNode)
        }

        const nodeIdToSegmentIds = new Map<CapacityMeshNodeId, SegmentId[]>()
        const segmentIdToNodeIds = new Map<SegmentId, CapacityMeshNodeId[]>()

        for (const segment of unravel2.assignedSegments) {
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
          colorMap: unravel2.colorMap,
        })
      }}
    />
  )
}
