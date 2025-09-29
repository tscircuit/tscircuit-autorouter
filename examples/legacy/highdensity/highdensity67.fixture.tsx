import cn3496 from "examples/legacy/assets/cn3496-nodeWithPortPoints.json"
import { HyperHighDensityDebugger } from "lib/testing/HyperHighDensityDebugger"

export const hyperParameters = {
  SEGMENTS_PER_POLYLINE: 6,
}

export default () => {
  return (
    <HyperHighDensityDebugger nodeWithPortPoints={cn3496.nodeWithPortPoints} />
  )
}
