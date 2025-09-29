import SegmentOptimizerDebugger from "lib/testing/SegmentOptimizerDebugger"
import inputs from "examples/legacy/assets/segmenttopoint4.json"

export default function SegmentToPoint4Fixture() {
  return (
    <SegmentOptimizerDebugger
      segments={inputs.segments as any}
      colorMap={inputs.colorMap}
      nodes={inputs.nodes as any}
    />
  )
}
