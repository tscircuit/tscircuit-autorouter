import { UnravelSectionSolver } from "lib/solvers/UnravelSolver/UnravelSectionSolver"
import UnravelSectionDebugger from "lib/testing/UnravelSectionDebugger"
import unravel5 from "examples/legacy/assets/unravel_section_cn125220_input.json"
import { getDedupedSegments } from "lib/solvers/UnravelSolver/getDedupedSegments"
import { CapacityMeshNode, CapacityMeshNodeId } from "lib/types"
import { SegmentId } from "lib/solvers/UnravelSolver/types"

export default function Unravel4() {
  return (
    <UnravelSectionDebugger
      createSolver={() => {
        return new UnravelSectionSolver({
          ...unravel5,
          dedupedSegmentMap: new Map(
            Object.entries(unravel5.dedupedSegmentMap),
          ),
          nodeIdToSegmentIds: new Map(
            Object.entries(unravel5.nodeIdToSegmentIds),
          ),
          segmentIdToNodeIds: new Map(
            Object.entries(unravel5.segmentIdToNodeIds),
          ),
          nodeMap: new Map(Object.entries(unravel5.nodeMap)),
          segmentToSegmentPointMap: new Map(
            Object.entries(unravel5.segmentToSegmentPointMap),
          ),
          nodeToSegmentPointMap: new Map(
            Object.entries(unravel5.nodeToSegmentPointMap),
          ),
          segmentPointMap: new Map(Object.entries(unravel5.segmentPointMap)),
        } as any)
      }}
    />
  )
}
