import cn1878 from "examples/legacy/assets/cn1878-nodeWithPortPoints.json"
import { HyperHighDensityDebugger } from "lib/testing/HyperHighDensityDebugger"

export const hyperParameters = {
  SEGMENTS_PER_POLYLINE: 6,
}

export default () => {
  return (
    <HyperHighDensityDebugger nodeWithPortPoints={cn1878.nodeWithPortPoints} />
  )
}
