import { UnravelSectionSolver } from "lib/solvers/UnravelSolver/UnravelSectionSolver"
import UnravelSectionDebugger from "lib/testing/UnravelSectionDebugger"
import unravel8 from "examples/legacy/assets/unravel_section_cn90994_input.json"

export default () => {
  return (
    <UnravelSectionDebugger
      createSolver={() => {
        return new UnravelSectionSolver({
          ...unravel8,
          MUTABLE_HOPS: 1,
          dedupedSegmentMap: new Map(
            Object.entries(unravel8.dedupedSegmentMap),
          ),
          nodeIdToSegmentIds: new Map(
            Object.entries(unravel8.nodeIdToSegmentIds),
          ),
          segmentIdToNodeIds: new Map(
            Object.entries(unravel8.segmentIdToNodeIds),
          ),
          nodeMap: new Map(Object.entries(unravel8.nodeMap)),
          segmentToSegmentPointMap: new Map(
            Object.entries(unravel8.segmentToSegmentPointMap),
          ),
          nodeToSegmentPointMap: new Map(
            Object.entries(unravel8.nodeToSegmentPointMap),
          ),
          segmentPointMap: new Map(Object.entries(unravel8.segmentPointMap)),
        } as any)
      }}
    />
  )
}
