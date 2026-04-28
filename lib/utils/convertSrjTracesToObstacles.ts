import type { Obstacle, SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"

type RoutePoint = SimplifiedPcbTrace["route"][number]
type WireRoutePoint = Extract<RoutePoint, { route_type: "wire" }>
type ViaRoutePoint = Extract<RoutePoint, { route_type: "via" }>
type ThroughObstacleRoutePoint = Extract<
  RoutePoint,
  { route_type: "through_obstacle" }
>

const MIN_OBSTACLE_DIMENSION = 0.001

const isWireRoutePoint = (point: RoutePoint): point is WireRoutePoint =>
  point.route_type === "wire"

const isViaRoutePoint = (point: RoutePoint): point is ViaRoutePoint =>
  point.route_type === "via"

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
}: {
  obstacleId: string
  start: { x: number; y: number }
  end: { x: number; y: number }
  width: number
  layer: string
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
    width: length,
    height: Math.max(width, MIN_OBSTACLE_DIMENSION),
    ccwRotationDegrees: (Math.atan2(dy, dx) * 180) / Math.PI,
    connectedTo: [],
  }
}

export const getObstaclesFromSrjTraces = (
  srj: SimpleRouteJson | null | undefined,
): Obstacle[] => {
  if (!srj) return []

  const traceObstacles: Obstacle[] = []
  const viaDimensions = getViaDimensions(srj)

  for (const [traceIndex, trace] of (srj.traces ?? []).entries()) {
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
          connectedTo: [],
        })
        continue
      }

      if (isThroughObstacleRoutePoint(routePoint)) {
        const obstacle = createSegmentObstacle({
          obstacleId: `trace_obstacle_${trace.pcb_trace_id}_${traceIndex}_${pointIndex}_through`,
          start: routePoint.start,
          end: routePoint.end,
          width: routePoint.width,
          layer: routePoint.from_layer,
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
        routePoint.layer !== nextRoutePoint.layer
      ) {
        continue
      }

      const obstacle = createSegmentObstacle({
        obstacleId: `trace_obstacle_${trace.pcb_trace_id}_${traceIndex}_${pointIndex}_wire`,
        start: routePoint,
        end: nextRoutePoint,
        width: routePoint.width,
        layer: routePoint.layer,
      })

      if (obstacle) traceObstacles.push(obstacle)
    }
  }

  return traceObstacles
}

export function convertSrjTracesToObstacles(
  srj: SimpleRouteJson | null | undefined,
): SimpleRouteJson | null | undefined {
  if (!srj) return srj

  const traceObstacles = getObstaclesFromSrjTraces(srj)

  if (traceObstacles.length === 0) return srj

  return {
    ...srj,
    obstacles: [...(srj.obstacles ?? []), ...traceObstacles],
  }
}
