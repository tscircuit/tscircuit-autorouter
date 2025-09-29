import { UnravelSectionSolver } from "lib/solvers/UnravelSolver/UnravelSectionSolver"
import UnravelSectionDebugger from "lib/testing/UnravelSectionDebugger"
import unravel4 from "examples/legacy/assets/unravelsection04.json"
import { getDedupedSegments } from "lib/solvers/UnravelSolver/getDedupedSegments"
import { CapacityMeshNode, CapacityMeshNodeId } from "lib/types"
import { SegmentId } from "lib/solvers/UnravelSolver/types"

export default function Unravel4() {
  return (
    <UnravelSectionDebugger
      createSolver={() => {
        return new UnravelSectionSolver({
          ...unravel4,
          dedupedSegmentMap: new Map(
            Object.entries(unravel4.dedupedSegmentMap),
          ),
          nodeIdToSegmentIds: new Map(
            Object.entries(unravel4.nodeIdToSegmentIds),
          ),
          segmentIdToNodeIds: new Map(
            Object.entries(unravel4.segmentIdToNodeIds),
          ),
          nodeMap: new Map(Object.entries(unravel4.nodeMap)),
          segmentToSegmentPointMap: new Map(
            Object.entries(unravel4.segmentToSegmentPointMap),
          ),
          nodeToSegmentPointMap: new Map(
            Object.entries(unravel4.nodeToSegmentPointMap),
          ),
          segmentPointMap: new Map(Object.entries(unravel4.segmentPointMap)),
        } as any)
      }}
    />
  )
}
