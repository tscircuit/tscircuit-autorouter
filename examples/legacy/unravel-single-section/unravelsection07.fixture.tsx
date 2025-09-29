import { UnravelSectionSolver } from "lib/solvers/UnravelSolver/UnravelSectionSolver"
import UnravelSectionDebugger from "lib/testing/UnravelSectionDebugger"
import unravel7 from "examples/legacy/assets/unravel_section_cn27756_input.json"

export default () => {
  return (
    <UnravelSectionDebugger
      createSolver={() => {
        return new UnravelSectionSolver({
          ...unravel7,
          MUTABLE_HOPS: 1,
          dedupedSegmentMap: new Map(
            Object.entries(unravel7.dedupedSegmentMap),
          ),
          nodeIdToSegmentIds: new Map(
            Object.entries(unravel7.nodeIdToSegmentIds),
          ),
          segmentIdToNodeIds: new Map(
            Object.entries(unravel7.segmentIdToNodeIds),
          ),
          nodeMap: new Map(Object.entries(unravel7.nodeMap)),
          segmentToSegmentPointMap: new Map(
            Object.entries(unravel7.segmentToSegmentPointMap),
          ),
          nodeToSegmentPointMap: new Map(
            Object.entries(unravel7.nodeToSegmentPointMap),
          ),
          segmentPointMap: new Map(Object.entries(unravel7.segmentPointMap)),
        } as any)
      }}
    />
  )
}
