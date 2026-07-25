import type { Obstacle, SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { JUMPER_DIMENSIONS } from "lib/utils/jumperSizes"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"

type RoutePoint = SimplifiedPcbTrace["route"][number]
type WireRoutePoint = Extract<RoutePoint, { route_type: "wire" }>
type ViaRoutePoint = Extract<RoutePoint, { route_type: "via" }>
type JumperRoutePoint = Extract<RoutePoint, { route_type: "jumper" }>
type ThroughObstacleRoutePoint = Extract<
  RoutePoint,
  { route_type: "through_obstacle" }
>

const MIN_OBSTACLE_DIMENSION = 0.001
const JUMPER_ENDPOINT_TOLERANCE = 0.01

type TraceObstacleOptions = {
  includeSquareCaps?: boolean
  includeConnectionNameInConnectedTo?: boolean
  modelJumperPads?: boolean
}

const isWireRoutePoint = (point: RoutePoint): point is WireRoutePoint =>
  point.route_type === "wire"

const isViaRoutePoint = (point: RoutePoint): point is ViaRoutePoint =>
  point.route_type === "via"

const isJumperRoutePoint = (point: RoutePoint): point is JumperRoutePoint =>
  point.route_type === "jumper"

const isThroughObstacleRoutePoint = (
  point: RoutePoint,
): point is ThroughObstacleRoutePoint => point.route_type === "through_obstacle"

const getLayersBetween = (
  fromLayer: string,
  toLayer: string,
  layerCount: number,
) => {
  const fromZ = mapLayerNameToZ(fromLayer, layerCount)
  const toZ = mapLayerNameToZ(toLayer, layerCount)
  const minZ = Math.min(fromZ, toZ)
  const maxZ = Math.max(fromZ, toZ)

  return Array.from({ length: maxZ - minZ + 1 }, (_, index) =>
    mapZToLayerName(minZ + index, layerCount),
  )
}

const createSegmentObstacle = ({
  obstacleId,
  start,
  end,
  width,
  layer,
  connectedTo,
  includeSquareCaps,
}: {
  obstacleId: string
  start: { x: number; y: number }
  end: { x: number; y: number }
  width: number
  layer: string
  connectedTo: string[]
  includeSquareCaps: boolean
}): Obstacle | null => {
  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.hypot(dx, dy)

  if (length <= MIN_OBSTACLE_DIMENSION) return null

  return {
    obstacleId,
    type: "rect",
    layers: [layer],
    center: {
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2,
    },
    // Pipeline9 uses square-cap rectangles so the projected hypergraph
    // reservation includes one trace radius beyond each route point. Other
    // pipelines retain their legacy centerline obstacle geometry.
    width:
      length +
      (includeSquareCaps ? Math.max(width, MIN_OBSTACLE_DIMENSION) : 0),
    height: Math.max(width, MIN_OBSTACLE_DIMENSION),
    ccwRotationDegrees: (Math.atan2(dy, dx) * 180) / Math.PI,
    connectedTo,
  }
}

const pointsMatch = (
  left: { x: number; y: number },
  right: { x: number; y: number },
): boolean =>
  Math.abs(left.x - right.x) < JUMPER_ENDPOINT_TOLERANCE &&
  Math.abs(left.y - right.y) < JUMPER_ENDPOINT_TOLERANCE

const wireSegmentSpansJumper = (
  start: WireRoutePoint,
  end: WireRoutePoint,
  jumpers: JumperRoutePoint[],
): boolean =>
  jumpers.some(
    (jumper) =>
      (pointsMatch(start, jumper.start) && pointsMatch(end, jumper.end)) ||
      (pointsMatch(start, jumper.end) && pointsMatch(end, jumper.start)),
  )

const createJumperPadObstacles = ({
  traceId,
  traceIndex,
  jumper,
  pointIndex,
  connectedTo,
}: {
  traceId: string
  traceIndex: number
  jumper: JumperRoutePoint
  pointIndex: number
  connectedTo: string[]
}): Obstacle[] => {
  const dimensions =
    JUMPER_DIMENSIONS[jumper.footprint] ?? JUMPER_DIMENSIONS["0603"]
  const dx = jumper.end.x - jumper.start.x
  const dy = jumper.end.y - jumper.start.y
  const rotationDegrees = (Math.atan2(dy, dx) * 180) / Math.PI

  return [jumper.start, jumper.end].map((center, padIndex) => ({
    obstacleId: `trace_obstacle_${traceId}_${traceIndex}_${pointIndex}_jumper_pad_${padIndex}`,
    type: "rect",
    layers: [jumper.layer],
    center: { ...center },
    width: Math.max(dimensions.padLength, MIN_OBSTACLE_DIMENSION),
    height: Math.max(dimensions.padWidth, MIN_OBSTACLE_DIMENSION),
    ccwRotationDegrees: rotationDegrees,
    connectedTo,
  }))
}

export const getObstaclesFromSrjTraces = (
  srj: SimpleRouteJson | null | undefined,
  options: TraceObstacleOptions = {},
): Obstacle[] => {
  if (!srj) return []

  const traceObstacles: Obstacle[] = []
  const viaDimensions = getViaDimensions(srj)

  for (const [traceIndex, trace] of (srj.traces ?? []).entries()) {
    const connectedTo = [
      ...new Set([
        ...(options.includeConnectionNameInConnectedTo
          ? [trace.connection_name]
          : []),
        ...(trace.connectsTo ?? []),
      ]),
    ]
    const jumpers = trace.route.filter(isJumperRoutePoint)

    for (let pointIndex = 0; pointIndex < trace.route.length; pointIndex++) {
      const routePoint = trace.route[pointIndex]!

      if (isViaRoutePoint(routePoint)) {
        const viaDiameter = routePoint.via_diameter ?? viaDimensions.padDiameter
        traceObstacles.push({
          obstacleId: `trace_obstacle_${trace.pcb_trace_id}_${traceIndex}_${pointIndex}_via`,
          type: "rect",
          layers: getLayersBetween(
            routePoint.from_layer,
            routePoint.to_layer,
            srj.layerCount,
          ),
          center: { x: routePoint.x, y: routePoint.y },
          width: Math.max(viaDiameter, MIN_OBSTACLE_DIMENSION),
          height: Math.max(viaDiameter, MIN_OBSTACLE_DIMENSION),
          connectedTo,
        })
        continue
      }

      if (isJumperRoutePoint(routePoint) && options.modelJumperPads) {
        traceObstacles.push(
          ...createJumperPadObstacles({
            traceId: trace.pcb_trace_id,
            traceIndex,
            jumper: routePoint,
            pointIndex,
            connectedTo,
          }),
        )
        continue
      }

      if (isThroughObstacleRoutePoint(routePoint)) {
        const obstacle = createSegmentObstacle({
          obstacleId: `trace_obstacle_${trace.pcb_trace_id}_${traceIndex}_${pointIndex}_through`,
          start: routePoint.start,
          end: routePoint.end,
          width: routePoint.width,
          layer: routePoint.from_layer,
          connectedTo,
          includeSquareCaps: options.includeSquareCaps ?? false,
        })

        if (obstacle) {
          obstacle.layers = getLayersBetween(
            routePoint.from_layer,
            routePoint.to_layer,
            srj.layerCount,
          )
          traceObstacles.push(obstacle)
        }
      }
    }

    for (
      let pointIndex = 0;
      pointIndex < trace.route.length - 1;
      pointIndex++
    ) {
      const routePoint = trace.route[pointIndex]!
      const nextRoutePoint = trace.route[pointIndex + 1]!

      if (
        !isWireRoutePoint(routePoint) ||
        !isWireRoutePoint(nextRoutePoint) ||
        routePoint.layer !== nextRoutePoint.layer ||
        (options.modelJumperPads &&
          wireSegmentSpansJumper(routePoint, nextRoutePoint, jumpers))
      ) {
        continue
      }

      const obstacle = createSegmentObstacle({
        obstacleId: `trace_obstacle_${trace.pcb_trace_id}_${traceIndex}_${pointIndex}_wire`,
        start: routePoint,
        end: nextRoutePoint,
        width: routePoint.width,
        layer: routePoint.layer,
        connectedTo,
        includeSquareCaps: options.includeSquareCaps ?? false,
      })

      if (obstacle) traceObstacles.push(obstacle)
    }
  }

  return traceObstacles
}

export function convertSrjTracesToObstacles(
  srj: SimpleRouteJson | null | undefined,
  options: TraceObstacleOptions = {},
): SimpleRouteJson | null | undefined {
  if (!srj) return srj

  const traceObstacles = getObstaclesFromSrjTraces(srj, options)

  if (traceObstacles.length === 0) return srj

  return {
    ...srj,
    obstacles: [...(srj.obstacles ?? []), ...traceObstacles],
  }
}
