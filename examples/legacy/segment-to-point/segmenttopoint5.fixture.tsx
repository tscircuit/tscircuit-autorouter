import SegmentOptimizerDebugger from "lib/testing/SegmentOptimizerDebugger"
import inputs from "examples/legacy/assets/segmenttopoint5.json"

export default function SegmentToPoint5Fixture() {
  return (
    <SegmentOptimizerDebugger
      segments={inputs.assignedSegments}
      colorMap={inputs.colorMap}
      nodes={inputs.nodes as any}
    />
  )
}
