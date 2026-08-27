import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"

const MIN_ROUTE_DIMENSION = 1e-9

export type PreloadedHighDensityRoute = HighDensityRoute & {
  preloadedTraceIndex: number
  preloadedRouteIndex: number
  preloadedRoutePositionStart?: number
  preloadedRoutePositionEnd?: number
  isThroughObstacle?: boolean
}

export const convertPreloadedTraceToHdRoutes = (
  trace: SimplifiedPcbTrace,
  traceIndex: number,
  layerCount: number,
  defaultViaDiameter: number,
  connMap: ConnectivityMap,
): PreloadedHighDensityRoute[] => {
  const rootConnectionName =
    connMap.getNetConnectedToId(trace.connection_name) ?? trace.connection_name
  const routes: PreloadedHighDensityRoute[] = []
  const addRoute = (
    route: HighDensityRoute["route"],
    traceThickness: number,
    viaDiameter = defaultViaDiameter,
    vias: Array<{ x: number; y: number }> = [],
    routePositionStart?: number,
    routePositionEnd?: number,
    isThroughObstacle = false,
  ) => {
    if (route.length < 2) return
    routes.push({
      connectionName: `${trace.connection_name}_fixed_${traceIndex}_${routes.length}`,
      rootConnectionName,
      preloadedTraceIndex: traceIndex,
      preloadedRouteIndex: routes.length,
      preloadedRoutePositionStart: routePositionStart,
      preloadedRoutePositionEnd: routePositionEnd,
      isThroughObstacle,
      traceThickness: Math.max(MIN_ROUTE_DIMENSION, traceThickness),
      viaDiameter: Math.max(MIN_ROUTE_DIMENSION, viaDiameter),
      route,
      vias,
    })
  }

  for (let pointIndex = 0; pointIndex < trace.route.length; pointIndex++) {
    const point = trace.route[pointIndex]!
    if (point.route_type === "via") {
      addRoute(
        [
          {
            x: point.x,
            y: point.y,
            z: mapLayerNameToZ(point.from_layer, layerCount),
          },
          {
            x: point.x,
            y: point.y,
            z: mapLayerNameToZ(point.to_layer, layerCount),
          },
        ],
        MIN_ROUTE_DIMENSION,
        point.via_diameter ?? defaultViaDiameter,
        [{ x: point.x, y: point.y }],
        pointIndex,
        pointIndex,
      )
      continue
    }

    if (point.route_type === "through_obstacle") {
      const fromZ = mapLayerNameToZ(point.from_layer, layerCount)
      const toZ = mapLayerNameToZ(point.to_layer, layerCount)
      for (let z = Math.min(fromZ, toZ); z <= Math.max(fromZ, toZ); z++) {
        addRoute(
          [
            { ...point.start, z },
            { ...point.end, z },
          ],
          point.width,
          defaultViaDiameter,
          [],
          pointIndex,
          pointIndex + 1,
          true,
        )
      }
      continue
    }

    const nextPoint = trace.route[pointIndex + 1]
    if (
      point.route_type !== "wire" ||
      nextPoint?.route_type !== "wire" ||
      point.layer !== nextPoint.layer
    ) {
      continue
    }

    if (point.x === nextPoint.x && point.y === nextPoint.y) continue

    addRoute(
      [
        {
          x: point.x,
          y: point.y,
          z: mapLayerNameToZ(point.layer, layerCount),
        },
        {
          x: nextPoint.x,
          y: nextPoint.y,
          z: mapLayerNameToZ(nextPoint.layer, layerCount),
        },
      ],
      Math.max(point.width, nextPoint.width),
      defaultViaDiameter,
      [],
      pointIndex,
      pointIndex + 1,
    )
  }

  return routes
}
