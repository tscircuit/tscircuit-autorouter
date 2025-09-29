import { UnravelSectionSolver } from "lib/solvers/UnravelSolver/UnravelSectionSolver"
import UnravelSectionDebugger from "lib/testing/UnravelSectionDebugger"
import unravel9 from "examples/legacy/assets/unravel_section_cn76527_input.json"

export default () => {
  return (
    <UnravelSectionDebugger
      createSolver={() => {
        return new UnravelSectionSolver({
          ...unravel9,
          MUTABLE_HOPS: 1,
          dedupedSegmentMap: new Map(
            Object.entries(unravel9.dedupedSegmentMap),
          ),
          nodeIdToSegmentIds: new Map(
            Object.entries(unravel9.nodeIdToSegmentIds),
          ),
          segmentIdToNodeIds: new Map(
            Object.entries(unravel9.segmentIdToNodeIds),
          ),
          nodeMap: new Map(Object.entries(unravel9.nodeMap)),
          segmentToSegmentPointMap: new Map(
            Object.entries(unravel9.segmentToSegmentPointMap),
          ),
          nodeToSegmentPointMap: new Map(
            Object.entries(unravel9.nodeToSegmentPointMap),
          ),
          segmentPointMap: new Map(Object.entries(unravel9.segmentPointMap)),
        } as any)
      }}
    />
  )
}
