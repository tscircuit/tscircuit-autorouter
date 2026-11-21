import type {
  SegmentPortPoint,
  SharedEdgeSegment,
} from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type { PreloadedCopperLookup } from "./createPreloadedCopperLookup"
import { PRELOADED_TRACE_TOLERANCE } from "./getPreloadedTracePrimitives"
import type { ClearanceGap } from "./findConflictingGapKeys"

export type ClearanceGapPort = ClearanceGap & { port: SegmentPortPoint }

/** Add a crossing candidate in each clear boundary interval that has no free port. */
export function getPreloadedClearanceGapPorts({
  segment,
  z,
  copperLookup,
}: {
  segment: SharedEdgeSegment
  z: number
  copperLookup: PreloadedCopperLookup
}): ClearanceGapPort[] {
  const dx = segment.end.x - segment.start.x
  const dy = segment.end.y - segment.start.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return []
  const length = Math.sqrt(lengthSquared)
  const layerPorts = segment.portPoints.filter((port) =>
    port.availableZ.includes(z),
  )
  const template = layerPorts[0]
  if (!template) return []
  const freePortFractions = layerPorts
    .filter((port) => !port._preloadedTracePortAssignments?.length)
    .map(
      (port) =>
        ((port.x - segment.start.x) * dx + (port.y - segment.start.y) * dy) /
        lengthSquared,
    )
  const gapPorts: ClearanceGapPort[] = []
  const clearSpans = copperLookup.getClearSpans({ ...segment, z })
  for (const [index, [start, end]] of clearSpans.entries()) {
    if ((end - start) * length <= PRELOADED_TRACE_TOLERANCE) continue
    const hasFreePort = freePortFractions.some(
      (fraction) => fraction > start + 1e-9 && fraction < end - 1e-9,
    )
    if (hasFreePort) continue
    const fraction = (start + end) / 2
    const port: SegmentPortPoint = {
      ...template,
      segmentPortPointId: `${segment.edgeId}_preloadgap${index}_z${z}`,
      x: segment.start.x + dx * fraction,
      y: segment.start.y + dy * fraction,
      availableZ: [z],
      connectionName: null,
      rootConnectionName: undefined,
      _preloadedFixedNetIds: undefined,
      _preloadedTracePortAssignments: undefined,
      distToCentermostPortOnZ: Math.abs(fraction - 0.5) * length,
    }
    const gapStart = {
      x: segment.start.x + dx * start,
      y: segment.start.y + dy * start,
    }
    const gapEnd = {
      x: segment.start.x + dx * end,
      y: segment.start.y + dy * end,
    }
    gapPorts.push({
      // Edge IDs can change when the mesh is rebuilt.
      key: JSON.stringify([segment.nodeIds, z, [gapStart, gapEnd]]),
      start: gapStart,
      end: gapEnd,
      port,
    })
  }
  return gapPorts
}
