import { UnravelSectionSolver } from "lib/solvers/UnravelSolver/UnravelSectionSolver"
import UnravelSectionDebugger from "lib/testing/UnravelSectionDebugger"
import unravel11 from "examples/legacy/assets/unravel_section_cn34933_input.json"

export default () => {
  return (
    <UnravelSectionDebugger
      createSolver={() => {
        return new UnravelSectionSolver({
          ...unravel11,
          MUTABLE_HOPS: 3,
          dedupedSegmentMap: new Map(
            Object.entries(unravel11.dedupedSegmentMap),
          ),
          nodeIdToSegmentIds: new Map(
            Object.entries(unravel11.nodeIdToSegmentIds),
          ),
          segmentIdToNodeIds: new Map(
            Object.entries(unravel11.segmentIdToNodeIds),
          ),
          nodeMap: new Map(Object.entries(unravel11.nodeMap)),
          segmentToSegmentPointMap: new Map(
            Object.entries(unravel11.segmentToSegmentPointMap),
          ),
          nodeToSegmentPointMap: new Map(
            Object.entries(unravel11.nodeToSegmentPointMap),
          ),
          segmentPointMap: new Map(Object.entries(unravel11.segmentPointMap)),
        } as any)
      }}
    />
  )
}
