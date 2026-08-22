import type { PreloadedHighDensityRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/convert-preloaded-traces-to-hd-routes"

export const highlightedFirstVia = { x: 8.443, y: -4.145 }
export const highlightedSecondVia = { x: 8.847, y: -4.447 }

const createFixedRoute = ({
  connectionName,
  preloadedRouteIndex,
  routePositionStart,
  routePositionEnd,
  route,
}: {
  connectionName: string
  preloadedRouteIndex: number
  routePositionStart: number
  routePositionEnd: number
  route: PreloadedHighDensityRoute["route"]
}): PreloadedHighDensityRoute => ({
  connectionName,
  rootConnectionName: "source_trace_10",
  preloadedTraceIndex: 10,
  preloadedRouteIndex,
  preloadedRoutePositionStart: routePositionStart,
  preloadedRoutePositionEnd: routePositionEnd,
  traceThickness: 0.15,
  viaDiameter: 0.5,
  route,
  vias: route.slice(0, -1).flatMap((point, pointIndex) => {
    const nextPoint = route[pointIndex + 1]!
    return point.z !== nextPoint.z ? [{ x: nextPoint.x, y: nextPoint.y }] : []
  }),
})

export const createHighlightedMutationFixture = (): {
  updatedFixedRoutes: PreloadedHighDensityRoute[]
  regionalMutationMasks: Map<string, boolean[]>
} => {
  const updatedFixedRoutes = [
    createFixedRoute({
      connectionName: "source_trace_10_fixed_10_75",
      preloadedRouteIndex: 75,
      routePositionStart: 78,
      routePositionEnd: 85,
      route: [
        { x: 8.379, y: -4.038, z: 0 },
        { ...highlightedFirstVia, z: 0 },
        { ...highlightedFirstVia, z: 1 },
        { x: 8.716, y: -3.798, z: 1 },
      ],
    }),
    createFixedRoute({
      connectionName: "source_trace_10_fixed_10_82",
      preloadedRouteIndex: 82,
      routePositionStart: 85,
      routePositionEnd: 86,
      route: [
        { x: 8.716, y: -3.798, z: 1 },
        { x: 8.731, y: -3.994, z: 1 },
      ],
    }),
    createFixedRoute({
      connectionName: "source_trace_10_fixed_10_83",
      preloadedRouteIndex: 83,
      routePositionStart: 86,
      routePositionEnd: 87,
      route: [
        { x: 8.731, y: -3.994, z: 1 },
        { x: 8.76, y: -4.186, z: 1 },
      ],
    }),
    createFixedRoute({
      connectionName: "source_trace_10_fixed_10_84",
      preloadedRouteIndex: 84,
      routePositionStart: 87,
      routePositionEnd: 88,
      route: [
        { x: 8.76, y: -4.186, z: 1 },
        { x: 8.816, y: -4.376, z: 1 },
      ],
    }),
    createFixedRoute({
      connectionName: "source_trace_10_fixed_10_85",
      preloadedRouteIndex: 85,
      routePositionStart: 89,
      routePositionEnd: 93,
      route: [
        { x: 8.816, y: -4.376, z: 1 },
        { ...highlightedSecondVia, z: 1 },
        { ...highlightedSecondVia, z: 0 },
        { x: 8.92, y: -4.572, z: 0 },
      ],
    }),
  ]
  return {
    updatedFixedRoutes,
    regionalMutationMasks: new Map(
      updatedFixedRoutes.map((route) => [
        route.connectionName,
        Array(route.route.length - 1).fill(true),
      ]),
    ),
  }
}

export const createOutsideRegionViaRoute = (): PreloadedHighDensityRoute =>
  createFixedRoute({
    connectionName: "source_trace_10_fixed_10_0",
    preloadedRouteIndex: 0,
    routePositionStart: 0,
    routePositionEnd: 78,
    route: [
      { x: 2.5, y: -4.038, z: 0 },
      { x: 3, y: -4, z: 0 },
      { x: 3, y: -4, z: 1 },
      { x: 3.4, y: -4, z: 1 },
      { x: 3.4, y: -4, z: 0 },
      { x: 8.379, y: -4.038, z: 0 },
    ],
  })
