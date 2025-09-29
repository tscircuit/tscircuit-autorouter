import { UnravelSectionSolver } from "lib/solvers/UnravelSolver/UnravelSectionSolver"
import UnravelSectionDebugger from "lib/testing/UnravelSectionDebugger"
import unravel6 from "examples/legacy/assets/unravel_section_cn91066_input.json"
import { getDedupedSegments } from "lib/solvers/UnravelSolver/getDedupedSegments"
import { CapacityMeshNode, CapacityMeshNodeId } from "lib/types"
import { SegmentId } from "lib/solvers/UnravelSolver/types"

export default () => {
  return (
    <UnravelSectionDebugger
      createSolver={() => {
        return new UnravelSectionSolver({
          ...unravel6,
          dedupedSegmentMap: new Map(
            Object.entries(unravel6.dedupedSegmentMap),
          ),
          nodeIdToSegmentIds: new Map(
            Object.entries(unravel6.nodeIdToSegmentIds),
          ),
          segmentIdToNodeIds: new Map(
            Object.entries(unravel6.segmentIdToNodeIds),
          ),
          nodeMap: new Map(Object.entries(unravel6.nodeMap)),
          segmentToSegmentPointMap: new Map(
            Object.entries(unravel6.segmentToSegmentPointMap),
          ),
          nodeToSegmentPointMap: new Map(
            Object.entries(unravel6.nodeToSegmentPointMap),
          ),
          segmentPointMap: new Map(Object.entries(unravel6.segmentPointMap)),
        } as any)
      }}
    />
  )
}
