import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { isObstacleConnectedToRoute } from "lib/solvers/TraceWidthSolver/isObstacleConnectedToRoute"
import type {
  HighDensityRoute,
  NodeWithPortPoints,
  PortPoint,
} from "lib/types/high-density-types"
import type { Obstacle, SimpleRouteJson, SimplifiedPcbTrace } from "lib/types"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { getViaDrillLayers } from "lib/utils/getViaDrillLayers"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { isPointInRect } from "lib/utils/isPointInRect"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import type { PreloadedHighDensityRoute } from "./convertPreloadedTraceToHdRoutes"

type PreloadedTerminalInput = {
  fixedHdRoutes: PreloadedHighDensityRoute[]
  nodePortPoints: NodeWithPortPoints[]
  connMap: ConnectivityMap
  obstacles: Obstacle[]
  layerCount: number
}

// Match board-world points in mm (+X right, +Y up) to physical terminals.
export const addTerminalPcbPortIds = <Route extends HighDensityRoute>({
  routes,
  portPoints,
  connMap,
}: {
  routes: Route[]
  portPoints: PortPoint[]
  connMap: ConnectivityMap
}): Route[] => {
  const terminalPorts = portPoints.filter(
    (port) => port.pcb_port_id !== undefined,
  )
  return routes.map((route): Route => {
    const start = route.route[0]
    const end = route.route.at(-1)
    const netId =
      connMap.getNetConnectedToId(route.connectionName) ??
      route.rootConnectionName ??
      route.connectionName
    const sameNetTerminals = terminalPorts.filter(
      (terminal) =>
        (connMap.getNetConnectedToId(terminal.connectionName) ??
          terminal.rootConnectionName ??
          terminal.connectionName) === netId,
    )
    const startTerminal = sameNetTerminals.find(
      (terminal) =>
        start !== undefined &&
        terminal.x === start.x &&
        terminal.y === start.y &&
        terminal.z === start.z,
    )
    const endTerminal = sameNetTerminals.find(
      (terminal) =>
        end !== undefined &&
        terminal.x === end.x &&
        terminal.y === end.y &&
        terminal.z === end.z,
    )

    const startPcbPortId = route.startPcbPortId ?? startTerminal?.pcb_port_id
    const endPcbPortId = route.endPcbPortId ?? endTerminal?.pcb_port_id
    if (
      startPcbPortId === route.startPcbPortId &&
      endPcbPortId === route.endPcbPortId
    ) {
      return route
    }
    return { ...route, startPcbPortId, endPcbPortId }
  })
}

function isRouteInsideConnectedPad(
  route: PreloadedHighDensityRoute,
  { connMap, obstacles, layerCount }: PreloadedTerminalInput,
): boolean {
  const hasTerminal =
    route.startPcbPortId !== undefined || route.endPcbPortId !== undefined
  if (!hasTerminal || route.vias.length > 0) return false
  for (const obstacle of obstacles) {
    const isRectangularPad = obstacle.type === "rect" && !obstacle.shape
    if (!isRectangularPad) continue
    if (!isObstacleConnectedToRoute(obstacle, route, connMap)) continue
    const isInsidePad = route.route.every(
      (point) =>
        obstacle.layers.includes(mapZToLayerName(point.z, layerCount)) &&
        isPointInRect(point, obstacle),
    )
    if (isInsidePad) return true
  }
  return false
}

export function preparePreloadedTerminalRoutes(
  input: PreloadedTerminalInput,
): PreloadedHighDensityRoute[] {
  const routes = addTerminalPcbPortIds({
    routes: input.fixedHdRoutes,
    portPoints: input.nodePortPoints.flatMap((node) => node.portPoints),
    connMap: input.connMap,
  })
  return routes.map((route): PreloadedHighDensityRoute => {
    if (!isRouteInsideConnectedPad(route, input)) return route
    // This path is component copper; regional repair must preserve it.
    return { ...route, isThroughObstacle: true }
  })
}

/** Terminal vias are appended during trace export. Include their barrels in
 * repair's fixed copper. Interior vias already travel with the movable route. */
export function getTerminalViaRoutes(
  traces: SimplifiedPcbTrace[],
  srj: SimpleRouteJson,
): HighDensityRoute[] {
  const routes: HighDensityRoute[] = []
  for (const trace of traces) {
    const first = trace.route[0]
    const last = trace.route.findLast((point) => point.route_type !== "jumper")
    for (const via of new Set([first, last])) {
      if (via?.route_type !== "via") continue
      const { x, y } = via
      const layers = getViaDrillLayers(
        via,
        srj.layerCount,
        srj.allowBlindAndBuriedVias === true,
      )
      routes.push({
        connectionName: trace.connection_name,
        route: [layers[0]!, layers.at(-1)!].map((layer) => ({
          x,
          y,
          z: mapLayerNameToZ(layer, srj.layerCount),
        })),
        vias: [{ x, y }],
        viaDiameter: via.via_diameter ?? getViaDimensions(srj).padDiameter,
        traceThickness: srj.minTraceWidth,
      })
    }
  }
  return routes
}
