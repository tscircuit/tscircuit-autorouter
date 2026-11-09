import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { SimplifiedPcbTrace } from "lib/types"
import type { HighDensityRoute } from "lib/types/high-density-types"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"

const MIN_ROUTE_DIMENSION = 1e-9

export type PreloadedHighDensityRoute = HighDensityRoute & {
  isFixed?: boolean
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
      isFixed: trace.isFixed,
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
      const fromZ = mapLayerNameToZ(point.from_layer, layerCount)
      const toZ = mapLayerNameToZ(point.to_layer, layerCount)
      // A via section can acquire planar wire when routing relocates it.
      // Inherit the adjoining copper width so that new wire is planned and
      // serialized at its physical width, never the bare-via placeholder.
      const adjoiningWireWidths = trace.route.flatMap((start, index) => {
        const end = trace.route[index + 1]
        if (
          start.route_type !== "wire" ||
          end?.route_type !== "wire" ||
          start.layer !== end.layer
        )
          return []
        const wireZ = mapLayerNameToZ(start.layer, layerCount)
        if (wireZ < Math.min(fromZ, toZ) || wireZ > Math.max(fromZ, toZ))
          return []
        return [start, end].some(
          (endpoint) =>
            Math.hypot(endpoint.x - point.x, endpoint.y - point.y) <=
            MIN_ROUTE_DIMENSION,
        )
          ? [start.width]
          : []
      })
      addRoute(
        [
          {
            x: point.x,
            y: point.y,
            z: fromZ,
          },
          {
            x: point.x,
            y: point.y,
            z: toZ,
          },
        ],
        adjoiningWireWidths.length > 0
          ? Math.min(...adjoiningWireWidths)
          : MIN_ROUTE_DIMENSION,
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
      point.width,
      defaultViaDiameter,
      [],
      pointIndex,
      pointIndex + 1,
    )
  }

  return routes
}
