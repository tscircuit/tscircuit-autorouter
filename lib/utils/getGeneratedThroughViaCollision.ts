import { pointToSegmentDistance } from "@tscircuit/math-utils"
import type {
  Obstacle,
  SimpleRouteJson,
  SimplifiedPcbTrace,
  SimplifiedPcbTraces,
} from "lib/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import {
  getGeneratedViaRefs,
  shouldUseThroughVias,
} from "lib/utils/materializeGeneratedThroughVias"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { JUMPER_DIMENSIONS } from "lib/utils/jumperSizes"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"

type TraceSegment = {
  trace: SimplifiedPcbTrace
  start: { x: number; y: number }
  end: { x: number; y: number }
  width: number
  layers: string[]
}

type JumperPad = {
  trace: SimplifiedPcbTrace
  center: { x: number; y: number }
  width: number
  height: number
  layer: string
}

const pointToRotatedRectDistance = (
  point: { x: number; y: number },
  rect: {
    center: { x: number; y: number }
    width: number
    height: number
    ccwRotationDegrees?: number
  },
): number => {
  const angle = -((rect.ccwRotationDegrees ?? 0) * Math.PI) / 180
  const dx = point.x - rect.center.x
  const dy = point.y - rect.center.y
  const localX = dx * Math.cos(angle) - dy * Math.sin(angle)
  const localY = dx * Math.sin(angle) + dy * Math.cos(angle)
  const outsideX = Math.max(Math.abs(localX) - rect.width / 2, 0)
  const outsideY = Math.max(Math.abs(localY) - rect.height / 2, 0)
  return Math.hypot(outsideX, outsideY)
}

const getLayersBetween = (
  fromLayer: string,
  toLayer: string,
  layerCount: number,
): string[] => {
  const fromZ = mapLayerNameToZ(fromLayer, layerCount)
  const toZ = mapLayerNameToZ(toLayer, layerCount)
  const minZ = Math.min(fromZ, toZ)
  const maxZ = Math.max(fromZ, toZ)

  return Array.from({ length: maxZ - minZ + 1 }, (_, index) =>
    mapZToLayerName(minZ + index, layerCount),
  )
}

const getTraceIds = (trace: SimplifiedPcbTrace): string[] =>
  [
    trace.pcb_trace_id,
    trace.__replaces_pcb_trace_id,
    trace.connection_name,
    ...(trace.connectsTo ?? []),
  ].filter((id): id is string => id !== undefined)

const getTraceSegments = (
  traces: ReadonlyArray<SimplifiedPcbTrace>,
  layerCount: number,
): TraceSegment[] => {
  const segments: TraceSegment[] = []
  for (const trace of traces) {
    for (let routeIndex = 0; routeIndex < trace.route.length; routeIndex++) {
      const routePoint = trace.route[routeIndex]!
      const nextRoutePoint = trace.route[routeIndex + 1]
      if (
        routePoint.route_type === "wire" &&
        nextRoutePoint?.route_type === "wire" &&
        routePoint.layer === nextRoutePoint.layer
      ) {
        segments.push({
          trace,
          start: routePoint,
          end: nextRoutePoint,
          width: Math.max(routePoint.width, nextRoutePoint.width),
          layers: [routePoint.layer],
        })
      } else if (routePoint.route_type === "through_obstacle") {
        segments.push({
          trace,
          start: routePoint.start,
          end: routePoint.end,
          width: routePoint.width,
          layers: getLayersBetween(
            routePoint.from_layer,
            routePoint.to_layer,
            layerCount,
          ),
        })
      }
    }
  }
  return segments
}

const getJumperPads = (
  traces: ReadonlyArray<SimplifiedPcbTrace>,
): JumperPad[] =>
  traces.flatMap((trace) =>
    trace.route.flatMap((routePoint) => {
      if (routePoint.route_type !== "jumper") return []
      const dimensions = JUMPER_DIMENSIONS[routePoint.footprint]
      const isHorizontal =
        Math.abs(routePoint.end.x - routePoint.start.x) >
        Math.abs(routePoint.end.y - routePoint.start.y)
      const width = isHorizontal ? dimensions.padLength : dimensions.padWidth
      const height = isHorizontal ? dimensions.padWidth : dimensions.padLength
      return [routePoint.start, routePoint.end].map((center) => ({
        trace,
        center,
        width,
        height,
        layer: routePoint.layer,
      }))
    }),
  )

const layersOverlap = (
  firstLayers: ReadonlyArray<string>,
  secondLayers: ReadonlyArray<string>,
): boolean => {
  const firstLayerSet = new Set(firstLayers)
  return secondLayers.some((layer) => firstLayerSet.has(layer))
}

export const getGeneratedThroughViaCollision = ({
  srj,
  preservedInputTraces,
  outputTraces,
  collisionTraces = outputTraces,
}: {
  srj: SimpleRouteJson
  preservedInputTraces: ReadonlyArray<SimplifiedPcbTrace>
  outputTraces: SimplifiedPcbTraces
  collisionTraces?: SimplifiedPcbTraces
}): string | null => {
  if (!shouldUseThroughVias(srj.allowBlindAndBuriedVias)) return null

  const viaDimensions = getViaDimensions(srj)
  const combinedSrj = { ...srj, traces: collisionTraces }
  const connMap = getConnectivityMapFromSimpleRouteJson(combinedSrj)
  const generatedVias = getGeneratedViaRefs({
    inputTraces: preservedInputTraces,
    outputTraces,
  })
  const traceSegments = getTraceSegments(collisionTraces, srj.layerCount)
  const jumperPads = getJumperPads(collisionTraces)
  const allVias = collisionTraces.flatMap((trace) =>
    trace.route.flatMap((routePoint, routeIndex) =>
      routePoint.route_type === "via"
        ? [{ trace, routeIndex, via: routePoint }]
        : [],
    ),
  )
  const obstacleClearance =
    srj.minViaEdgeToPadEdgeClearance ?? srj.defaultObstacleMargin ?? 0
  const traceClearance = srj.defaultObstacleMargin ?? 0
  const staticObstacles = [
    ...srj.obstacles,
    ...(srj.jumpers ?? []).flatMap((jumper) => jumper.pads),
  ]

  const tracesAreConnected = (
    firstTrace: SimplifiedPcbTrace,
    secondTrace: SimplifiedPcbTrace,
  ): boolean =>
    getTraceIds(firstTrace).some((firstId) =>
      getTraceIds(secondTrace).some(
        (secondId) =>
          firstId === secondId || connMap.areIdsConnected(firstId, secondId),
      ),
    )
  const obstacleIsConnected = (
    trace: SimplifiedPcbTrace,
    obstacle: Obstacle,
  ): boolean =>
    getTraceIds(trace).some((traceId) =>
      obstacle.connectedTo.some(
        (obstacleId) =>
          traceId === obstacleId ||
          connMap.areIdsConnected(traceId, obstacleId),
      ),
    )

  for (const generatedVia of generatedVias) {
    const { trace, routeIndex, via } = generatedVia
    const viaLayers = getLayersBetween(
      via.from_layer,
      via.to_layer,
      srj.layerCount,
    )
    const viaRadius = (via.via_diameter ?? viaDimensions.padDiameter) / 2

    for (const obstacle of staticObstacles) {
      if (obstacle.isCopperPour) continue
      if (!layersOverlap(viaLayers, obstacle.layers)) continue
      if (obstacleIsConnected(trace, obstacle)) continue
      if (
        pointToRotatedRectDistance(via, obstacle) <
        viaRadius + obstacleClearance
      ) {
        return `Generated through via for ${trace.connection_name} at (${via.x}, ${via.y}) collides with obstacle ${obstacle.obstacleId ?? "without an id"} on ${obstacle.layers.join(", ")}`
      }
    }

    for (const jumperPad of jumperPads) {
      if (!viaLayers.includes(jumperPad.layer)) continue
      if (tracesAreConnected(trace, jumperPad.trace)) continue
      if (
        pointToRotatedRectDistance(via, jumperPad) <
        viaRadius + obstacleClearance
      ) {
        return `Generated through via for ${trace.connection_name} at (${via.x}, ${via.y}) collides with jumper pad on trace ${jumperPad.trace.pcb_trace_id} on ${jumperPad.layer}`
      }
    }

    for (const segment of traceSegments) {
      if (!layersOverlap(viaLayers, segment.layers)) continue
      if (tracesAreConnected(trace, segment.trace)) continue
      if (
        pointToSegmentDistance(via, segment.start, segment.end) <
        viaRadius + segment.width / 2 + traceClearance
      ) {
        return `Generated through via for ${trace.connection_name} at (${via.x}, ${via.y}) collides with trace ${segment.trace.pcb_trace_id} on ${segment.layers.join(", ")}`
      }
    }

    for (const otherVia of allVias) {
      if (otherVia.trace === trace && otherVia.routeIndex === routeIndex)
        continue
      if (tracesAreConnected(trace, otherVia.trace)) continue
      const otherViaLayers = getLayersBetween(
        otherVia.via.from_layer,
        otherVia.via.to_layer,
        srj.layerCount,
      )
      if (!layersOverlap(viaLayers, otherViaLayers)) continue
      const otherRadius =
        (otherVia.via.via_diameter ?? viaDimensions.padDiameter) / 2
      if (
        Math.hypot(via.x - otherVia.via.x, via.y - otherVia.via.y) <
        viaRadius + otherRadius + traceClearance
      ) {
        return `Generated through via for ${trace.connection_name} at (${via.x}, ${via.y}) collides with via on trace ${otherVia.trace.pcb_trace_id}`
      }
    }
  }

  return null
}
