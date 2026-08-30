import {
  pointToSegmentDistance,
  segmentToSegmentDistance,
} from "./exact-geometry"
import type {
  HybridCopperSegment,
  HybridCopperVia,
} from "./transactional-copper-types"
import type {
  HybridWorkerBoardContext,
  HybridWorkerGeometry,
  RegionSearchSpec,
} from "./worker-protocol"

export function candidateTouchesSequentialObstacles({
  baseGeometryCount,
  sequentialContext,
  candidateTraces,
  candidateVias,
}: {
  baseGeometryCount: number
  sequentialContext: HybridWorkerBoardContext
  candidateTraces: readonly HybridCopperSegment[]
  candidateVias: readonly HybridCopperVia[]
}): boolean {
  const obstacles = sequentialContext.geometry.slice(baseGeometryCount)
  for (const trace of candidateTraces) {
    for (const obstacle of obstacles) {
      if (obstacle.geometry.layer !== trace.layer) continue
      if (
        obstacle.geometry.kind === "segment" &&
        segmentToSegmentDistance({
          firstStart: trace.start,
          firstEnd: trace.end,
          secondStart: {
            x: obstacle.geometry.startX,
            y: obstacle.geometry.startY,
          },
          secondEnd: {
            x: obstacle.geometry.endX,
            y: obstacle.geometry.endY,
          },
        }) <=
          trace.widthMm / 2 + obstacle.geometry.widthMm / 2
      ) {
        return true
      }
      if (
        obstacle.geometry.kind === "circle" &&
        pointToSegmentDistance({
          point: {
            x: obstacle.geometry.centerX,
            y: obstacle.geometry.centerY,
          },
          start: trace.start,
          end: trace.end,
        }) <=
          trace.widthMm / 2 + obstacle.geometry.radiusMm
      ) {
        return true
      }
    }
  }
  for (const via of candidateVias) {
    const viaLayers = getWorkerViaLayers({
      context: sequentialContext,
      via,
    })
    for (const obstacle of obstacles) {
      if (!viaLayers.includes(obstacle.geometry.layer)) continue
      if (
        obstacle.geometry.kind === "segment" &&
        pointToSegmentDistance({
          point: via,
          start: {
            x: obstacle.geometry.startX,
            y: obstacle.geometry.startY,
          },
          end: {
            x: obstacle.geometry.endX,
            y: obstacle.geometry.endY,
          },
        }) <=
          via.padDiameterMm / 2 + obstacle.geometry.widthMm / 2
      ) {
        return true
      }
      if (
        obstacle.geometry.kind === "circle" &&
        Math.hypot(
          via.x - obstacle.geometry.centerX,
          via.y - obstacle.geometry.centerY,
        ) <=
          via.padDiameterMm / 2 + obstacle.geometry.radiusMm
      ) {
        return true
      }
    }
  }
  return false
}

function getWorkerViaLayers({
  context,
  via,
}: {
  context: HybridWorkerBoardContext
  via: HybridCopperVia
}): readonly string[] {
  const startLayerIndex = context.layerNames.indexOf(via.fromLayer)
  const endLayerIndex = context.layerNames.indexOf(via.toLayer)
  if (startLayerIndex < 0 || endLayerIndex < 0) {
    throw new Error(
      `candidate via ${via.copperId} references an unknown worker layer`,
    )
  }
  return context.layerNames.slice(
    Math.min(startLayerIndex, endLayerIndex),
    Math.max(startLayerIndex, endLayerIndex) + 1,
  )
}

export function buildSequentialSearchContext({
  context,
  addedTraces,
  addedVias,
  search,
  traceWidthMm,
  routingResolutionMm,
}: {
  context: HybridWorkerBoardContext
  addedTraces: readonly HybridCopperSegment[]
  addedVias: readonly HybridCopperVia[]
  search: RegionSearchSpec
  traceWidthMm: number
  routingResolutionMm: number
}): HybridWorkerBoardContext {
  if (addedTraces.length === 0 && addedVias.length === 0) return context
  const contactPoints = [search.start, search.goal]
  const traceGeometry = addedTraces.flatMap(
    (segment, segmentIndex): HybridWorkerGeometry[] => {
      const contactReserveMm =
        context.clearanceMm +
        segment.widthMm / 2 +
        traceWidthMm / 2 +
        routingResolutionMm * 2
      return subtractContactWindows({
        segment,
        contactPoints,
        contactReserveMm,
      }).map((interval, intervalIndex) =>
        Object.freeze({
          sourceKind: "copper" as const,
          geometry: Object.freeze({
            kind: "segment" as const,
            geometryId: `intra-job:segment:${segmentIndex}:${intervalIndex}`,
            layer: segment.layer,
            startX:
              segment.start.x +
              (segment.end.x - segment.start.x) * interval.start,
            startY:
              segment.start.y +
              (segment.end.y - segment.start.y) * interval.start,
            endX:
              segment.start.x +
              (segment.end.x - segment.start.x) * interval.end,
            endY:
              segment.start.y +
              (segment.end.y - segment.start.y) * interval.end,
            widthMm: segment.widthMm,
          }),
          connectedConnectionNames: Object.freeze([]),
        }),
      )
    },
  )
  const viaGeometry = addedVias.flatMap(
    (via, viaIndex): HybridWorkerGeometry[] => {
      const contactReserveMm =
        context.clearanceMm +
        via.padDiameterMm / 2 +
        traceWidthMm / 2 +
        routingResolutionMm * 2
      if (
        contactPoints.some(
          (point) =>
            Math.hypot(point.x - via.x, point.y - via.y) <=
            contactReserveMm,
        )
      ) {
        return []
      }
      const startLayerIndex = context.layerNames.indexOf(via.fromLayer)
      const endLayerIndex = context.layerNames.indexOf(via.toLayer)
      if (startLayerIndex < 0 || endLayerIndex < 0) {
        throw new Error(
          `intra-job via ${via.copperId} references an unknown worker layer`,
        )
      }
      return context.layerNames
        .slice(
          Math.min(startLayerIndex, endLayerIndex),
          Math.max(startLayerIndex, endLayerIndex) + 1,
        )
        .map((layer) =>
          Object.freeze({
            sourceKind: "copper" as const,
            geometry: Object.freeze({
              kind: "circle" as const,
              geometryId: `intra-job:via:${viaIndex}:${layer}`,
              layer,
              centerX: via.x,
              centerY: via.y,
              radiusMm: via.padDiameterMm / 2,
            }),
            connectedConnectionNames: Object.freeze([]),
          }),
        )
    },
  )
  return Object.freeze({
    ...context,
    geometry: Object.freeze([
      ...context.geometry,
      ...traceGeometry,
      ...viaGeometry,
    ]),
  })
}

type SegmentInterval = {
  readonly start: number
  readonly end: number
}

function subtractContactWindows({
  segment,
  contactPoints,
  contactReserveMm,
}: {
  segment: HybridCopperSegment
  contactPoints: readonly { readonly x: number; readonly y: number }[]
  contactReserveMm: number
}): readonly SegmentInterval[] {
  const deltaX = segment.end.x - segment.start.x
  const deltaY = segment.end.y - segment.start.y
  const lengthSquared = deltaX * deltaX + deltaY * deltaY
  if (lengthSquared === 0) return Object.freeze([])
  let intervals: readonly SegmentInterval[] = Object.freeze([
    Object.freeze({ start: 0, end: 1 }),
  ])
  for (const point of contactPoints) {
    const projection =
      ((point.x - segment.start.x) * deltaX +
        (point.y - segment.start.y) * deltaY) /
      lengthSquared
    const projectedPoint = {
      x: segment.start.x + deltaX * projection,
      y: segment.start.y + deltaY * projection,
    }
    const perpendicularDistance = Math.hypot(
      point.x - projectedPoint.x,
      point.y - projectedPoint.y,
    )
    if (perpendicularDistance >= contactReserveMm) continue
    const halfWindow =
      Math.sqrt(
        contactReserveMm * contactReserveMm -
          perpendicularDistance * perpendicularDistance,
      ) / Math.sqrt(lengthSquared)
    const windowStart = Math.max(0, projection - halfWindow)
    const windowEnd = Math.min(1, projection + halfWindow)
    if (windowStart >= windowEnd) continue
    intervals = Object.freeze(
      intervals.flatMap((interval): SegmentInterval[] => {
        if (windowEnd <= interval.start || windowStart >= interval.end) {
          return [interval]
        }
        const retained: SegmentInterval[] = []
        if (windowStart > interval.start) {
          retained.push(
            Object.freeze({ start: interval.start, end: windowStart }),
          )
        }
        if (windowEnd < interval.end) {
          retained.push(
            Object.freeze({ start: windowEnd, end: interval.end }),
          )
        }
        return retained
      }),
    )
  }
  return Object.freeze(
    intervals.filter(
      (interval) =>
        (interval.end - interval.start) * Math.sqrt(lengthSquared) > 1e-9,
    ),
  )
}
