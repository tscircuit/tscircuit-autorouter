import { UnravelSectionSolver } from "lib/solvers/UnravelSolver/UnravelSectionSolver"
import UnravelSectionDebugger from "lib/testing/UnravelSectionDebugger"
import unravel10 from "examples/legacy/assets/unravel_section_cn11206_input.json"

export default () => {
  return (
    <UnravelSectionDebugger
      createSolver={() => {
        return new UnravelSectionSolver({
          ...unravel10,
          MUTABLE_HOPS: 1,
          dedupedSegmentMap: new Map(
            Object.entries(unravel10.dedupedSegmentMap),
          ),
          nodeIdToSegmentIds: new Map(
            Object.entries(unravel10.nodeIdToSegmentIds),
          ),
          segmentIdToNodeIds: new Map(
            Object.entries(unravel10.segmentIdToNodeIds),
          ),
          nodeMap: new Map(Object.entries(unravel10.nodeMap)),
          segmentToSegmentPointMap: new Map(
            Object.entries(unravel10.segmentToSegmentPointMap),
          ),
          nodeToSegmentPointMap: new Map(
            Object.entries(unravel10.nodeToSegmentPointMap),
          ),
          segmentPointMap: new Map(Object.entries(unravel10.segmentPointMap)),
        } as any)
      }}
    />
  )
}
