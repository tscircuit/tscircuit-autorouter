import Flatbush from "flatbush"
import { BaseSolver } from "lib/solvers/BaseSolver"
import type { SharedEdgeSegment } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type { SimpleRouteJson } from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"
import { assignPreloadedTraceToBoundary } from "./assignPreloadedTraceToBoundary"
import { createPreloadedCopperLookup } from "./createPreloadedCopperLookup"
import { getPreloadedClearanceGapPorts } from "./getPreloadedClearanceGapPorts"
import {
  getPreloadedTracePrimitives,
  PRELOADED_TRACE_TOLERANCE,
  type PreloadedTracePrimitive,
} from "./getPreloadedTracePrimitives"

/**
 * Loads saved copper onto capacity-graph boundary ports. Empty clearance gaps
 * receive crossing ports without changing the mesh regions or trace geometry.
 */
export class PreloadedTraceGraphSolver extends BaseSolver {
  private readonly primitives: PreloadedTracePrimitive[]
  private readonly boundaryIndex: Flatbush | null

  constructor(
    private readonly sharedEdgeSegments: SharedEdgeSegment[],
    private readonly srj: SimpleRouteJson,
  ) {
    super()
    this.MAX_ITERATIONS = 1
    this.primitives = getPreloadedTracePrimitives(srj)
    this.boundaryIndex =
      sharedEdgeSegments.length > 0
        ? new Flatbush(sharedEdgeSegments.length)
        : null
    if (this.boundaryIndex) {
      for (const segment of sharedEdgeSegments) {
        this.boundaryIndex.add(
          Math.min(segment.start.x, segment.end.x),
          Math.min(segment.start.y, segment.end.y),
          Math.max(segment.start.x, segment.end.x),
          Math.max(segment.start.y, segment.end.y),
        )
      }
      this.boundaryIndex.finish()
    }
  }

  override getSolverName(): string {
    return "PreloadedTraceGraphSolver"
  }

  override _step(): void {
    const inputPortCount = this.sharedEdgeSegments.reduce(
      (count, segment) => count + segment.portPoints.length,
      0,
    )
    let boundaryDistanceCheckCount: number = 0
    for (const primitive of this.primitives) {
      if (this.boundaryIndex === null) break
      // Include near misses accepted by the exact geometric predicate. Keep
      // boundary order stable: competing fixed-net assignments are ordered.
      const candidates: number[] = this.boundaryIndex
        .search(
          Math.min(primitive.start.x, primitive.end.x) -
            PRELOADED_TRACE_TOLERANCE,
          Math.min(primitive.start.y, primitive.end.y) -
            PRELOADED_TRACE_TOLERANCE,
          Math.max(primitive.start.x, primitive.end.x) +
            PRELOADED_TRACE_TOLERANCE,
          Math.max(primitive.start.y, primitive.end.y) +
            PRELOADED_TRACE_TOLERANCE,
        )
        .sort((left, right) => left - right)
      for (const index of candidates) {
        const segment = this.sharedEdgeSegments[index]!
        boundaryDistanceCheckCount++
        if (
          minimumDistanceBetweenSegments(
            primitive.start,
            primitive.end,
            segment.start,
            segment.end,
          ) > PRELOADED_TRACE_TOLERANCE
        ) {
          continue
        }

        assignPreloadedTraceToBoundary({ segment, primitive })
      }
    }

    this.addClearanceGapPorts()
    const portPoints = this.sharedEdgeSegments.flatMap(
      (segment) => segment.portPoints,
    )
    const preloadedPortPoints = portPoints.filter(
      (portPoint) => (portPoint._preloadedFixedNetIds?.length ?? 0) > 0,
    )
    this.stats = {
      boundaryDistanceCheckCount,
      preloadedTraceCount: this.srj.traces?.length ?? 0,
      preloadedTraceShapeCount: this.primitives.length,
      inputBoundaryCount: this.sharedEdgeSegments.length,
      outputBoundaryCount: this.sharedEdgeSegments.length,
      inputPortCount,
      outputPortCount: portPoints.length,
      preloadedPortCount: preloadedPortPoints.length,
      tracePortAssignmentCount: preloadedPortPoints.reduce(
        (count, portPoint) =>
          count + (portPoint._preloadedTracePortAssignments?.length ?? 0),
        0,
      ),
      topologyChanged: portPoints.length !== inputPortCount,
    }
    this.solved = true
  }

  private addClearanceGapPorts(): void {
    if (!this.srj.traces?.some((trace) => trace.isFixed)) return
    const copperLookup = createPreloadedCopperLookup({
      srj: this.srj,
      connMap: getConnectivityMapFromSimpleRouteJson(this.srj),
      traceWidth: this.srj.minTraceWidth,
      viaDiameter: this.srj.minViaDiameter ?? 0.3,
    })
    for (const segment of this.sharedEdgeSegments) {
      for (const z of segment.availableZ) {
        const gapPorts = getPreloadedClearanceGapPorts({
          segment,
          z,
          copperLookup,
        })
        for (const port of gapPorts) segment.portPoints.push(port)
      }
    }
  }

  getOutput(): SharedEdgeSegment[] {
    if (!this.solved) {
      throw new Error("PreloadedTraceGraphSolver has not solved yet")
    }
    return this.sharedEdgeSegments
  }
}
