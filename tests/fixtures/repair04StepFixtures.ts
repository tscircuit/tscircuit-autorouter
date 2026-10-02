import type {
  HighDensityRoute,
  SimpleRouteJson,
} from "high-density-repair03/lib"
export const bounds = { minX: -4.5, maxX: 4.5, minY: -4.5, maxY: 4.5 }
export const srj: SimpleRouteJson = {
  bounds,
  layerCount: 1,
  minTraceWidth: 0.1,
  connections: [],
  obstacles: [
    {
      type: "rect",
      center: { x: 0, y: 0 },
      width: 0.6,
      height: 0.2,
      layers: ["top"],
      connectedTo: ["pad"],
    },
  ],
}
export const routes: HighDensityRoute[] = [0, 0.35, -0.35].map((y, index) => ({
  connectionName: `route${index}`,
  traceThickness: 0.1,
  viaDiameter: 0.3,
  vias: [],
  route: [
    { x: -4.5, y, z: 0 },
    { x: 4.5, y, z: 0 },
  ],
}))
export const negotiationInput = {
  srj,
  routes,
  bounds,
  dirtyRouteIndices: [0],
  isLocked: (): boolean => true,
  allowLayerChanges: false,
  traceClearance: 0.1,
  viaClearance: 0.1,
  maxPathSearchNodes: 120000,
  maxPathSearchCalls: 256,
}
export const pathInput = {
  srj,
  routes,
  routeIndex: 0,
  start: routes[0]!.route[0]!,
  end: routes[0]!.route[1]!,
  bounds,
  traceThickness: 0.1,
  traceClearance: 0.1,
  viaClearance: 0.1,
  gridSize: 0.05,
  allowLayerChanges: false,
  maxNodes: 1000,
}
export const projectionInput = {
  srj,
  routes: routes.map((route) => ({
    ...route,
    route: [
      route.route[0]!,
      { x: 0, y: route.route[0]!.y, z: 0 },
      route.route[1]!,
    ],
  })),
  bounds,
  boundaryMargin: 0,
  lockedPointIndices: routes.map(() => [true, false, true]),
  traceClearance: 0.1,
  viaClearance: 0.1,
}
