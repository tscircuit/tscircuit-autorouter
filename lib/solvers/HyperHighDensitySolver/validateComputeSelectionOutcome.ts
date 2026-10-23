import { pointToSegmentDistance } from "@tscircuit/math-utils"
import { getFixedObstacleViolations } from "@tscircuit/repair04"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { getDrcErrors, MIN_VIA_TO_VIA_CLEARANCE } from "lib/testing/getDrcErrors"
import { convertToCircuitJson, createPcbBoardElement } from "lib/testing/utils/convertToCircuitJson"
import type { HighDensityBoardGeometry } from "lib/types/high-density-board-geometry"
import type { HighDensityRoute, NodeWithPortPoints } from "lib/types/high-density-types"
import type { Obstacle, SimpleRouteJson } from "lib/types/srj-types"
import { convertHdRouteToSimplifiedRoute } from "lib/utils/convertHdRouteToSimplifiedRoute"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { getConnectionPortPointPairs } from "lib/utils/getConnectionPortPointPairs"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"
import { getObstacleRouteConnectivity } from "./getObstacleRouteConnectivity"

type ValidationParams = {
  routes: HighDensityRoute[]
  node: NodeWithPortPoints
  connMap?: ConnectivityMap
  obstacles: Obstacle[]
  layerCount: number
  traceWidth: number
  viaDiameter: number
  obstacleMargin: number
  boardGeometry?: HighDensityBoardGeometry
}

type CopperSegment = {
  start: HighDensityRoute["route"][number]
  end: HighDensityRoute["route"][number]
  root: string
}

const hasRequiredPortConnectivity = ({
  routes,
  node,
  connMap,
  layerCount,
}: ValidationParams): boolean => {
  const getRoot = (name: string): string => connMap?.getNetConnectedToId(name) ?? name
  const segments: CopperSegment[] = routes.flatMap((route) =>
    route.route.slice(0, -1).map((start, index) => ({
      start,
      end: route.route[index + 1]!,
      root: getRoot(route.rootConnectionName ?? route.connectionName),
    })),
  )
  if (segments.some(({ start, end }) =>
    ![start.x, start.y, start.z, end.x, end.y, end.z].every(Number.isFinite) ||
    !Number.isInteger(start.z) || !Number.isInteger(end.z) ||
    start.z < 0 || end.z < 0 || start.z >= layerCount || end.z >= layerCount ||
    (start.z !== end.z && start.toNextSegmentType !== "through_obstacle" &&
      Math.hypot(start.x - end.x, start.y - end.y) > 1e-6),
  )) return false
  const parent = segments.map((_, index) => index)
  const find = (index: number): number => {
    let root = index
    while (parent[root] !== root) root = parent[root]!
    while (parent[index] !== index) {
      const next = parent[index]!
      parent[index] = root
      index = next
    }
    return root
  }
  for (let left = 0; left < segments.length; left++) {
    const a = segments[left]!
    for (let right = 0; right < left; right++) {
      const b = segments[right]!
      if (a.root !== b.root) continue
      const minZ = Math.max(Math.min(a.start.z, a.end.z), Math.min(b.start.z, b.end.z))
      const maxZ = Math.min(Math.max(a.start.z, a.end.z), Math.max(b.start.z, b.end.z))
      if (minZ > maxZ) continue
      if (minimumDistanceBetweenSegments(a.start, a.end, b.start, b.end) > 1e-6) continue
      parent[find(left)] = find(right)
    }
  }
  const portsByConnection = new Map<string, NodeWithPortPoints["portPoints"]>()
  for (const port of node.portPoints) {
    const ports = portsByConnection.get(port.connectionName) ?? []
    ports.push(port)
    portsByConnection.set(port.connectionName, ports)
  }
  const pairs = node.portPointsInPairs?.length
    ? node.portPointsInPairs
    : [...portsByConnection.values()].flatMap(getConnectionPortPointPairs)
  const components = new Map<string, number>()
  for (const port of pairs.flat()) {
    const root = getRoot(port.rootConnectionName ?? port.connectionName)
    const segmentIndex = segments.findIndex((segment) =>
      segment.root === root &&
      port.z >= Math.min(segment.start.z, segment.end.z) &&
      port.z <= Math.max(segment.start.z, segment.end.z) &&
      pointToSegmentDistance(port, segment.start, segment.end) <= 1e-6,
    )
    if (segmentIndex < 0) return false
    components.set(`${port.connectionName}:${port.x}:${port.y}:${port.z}`, find(segmentIndex))
  }
  for (const [start, end] of pairs) {
    const from = components.get(`${start.connectionName}:${start.x}:${start.y}:${start.z}`)
    const to = components.get(`${end.connectionName}:${end.x}:${end.y}:${end.z}`)
    if (from === undefined || to === undefined || from !== to) return false
  }
  return true
}

/** Training labels require both physical clearance and requested connectivity. */
export const validateComputeSelectionOutcome = (params: ValidationParams): boolean => {
  const { routes, node, layerCount, connMap } = params
  if (routes.some((route) =>
    !Number.isFinite(route.traceThickness) ||
    route.traceThickness < params.traceWidth - 1e-9 ||
    !Number.isFinite(route.viaDiameter) ||
    route.viaDiameter < params.viaDiameter - 1e-9 ||
    route.route.some((point) => point.traceThickness !== undefined &&
      (!Number.isFinite(point.traceThickness) ||
        point.traceThickness < params.traceWidth - 1e-9)),
  )) return false
  if (!hasRequiredPortConnectivity(params)) return false
  const points = routes.flatMap((route) => route.route)
  const maxCopperWidth = Math.max(
    params.traceWidth,
    params.viaDiameter,
    ...routes.map((route) => Math.max(route.traceThickness, route.viaDiameter)),
    ...points.map((point) => point.traceThickness ?? 0),
  )
  const clearance = Math.max(params.obstacleMargin, MIN_VIA_TO_VIA_CLEARANCE)
  const radius = maxCopperWidth / 2 + clearance + 1e-6
  const minX = Math.min(...points.map((point) => point.x)) - radius
  const maxX = Math.max(...points.map((point) => point.x)) + radius
  const minY = Math.min(...points.map((point) => point.y)) - radius
  const maxY = Math.max(...points.map((point) => point.y)) + radius
  const obstacles = params.obstacles.filter((obstacle) => {
    const disk = Math.hypot(obstacle.width, obstacle.height) / 2
    return obstacle.center.x + disk >= minX && obstacle.center.x - disk <= maxX &&
      obstacle.center.y + disk >= minY && obstacle.center.y - disk <= maxY
  })
  const ownership = getObstacleRouteConnectivity({ obstacles, routes, connMap })
  const obstacleContainsPoint = (obstacle: Obstacle, point: { x: number; y: number }): boolean => {
    const radians = -(obstacle.ccwRotationDegrees ?? 0) * Math.PI / 180
    const dx = point.x - obstacle.center.x
    const dy = point.y - obstacle.center.y
    if (obstacle.shape === "circle") {
      return Math.hypot(dx, dy) <= Math.min(obstacle.width, obstacle.height) / 2 + 1e-6
    }
    const x = dx * Math.cos(radians) - dy * Math.sin(radians)
    const y = dx * Math.sin(radians) + dy * Math.cos(radians)
    return Math.abs(x) <= obstacle.width / 2 + 1e-6 &&
      Math.abs(y) <= obstacle.height / 2 + 1e-6
  }
  for (const [routeIndex, route] of routes.entries()) {
    for (let index = 0; index < route.route.length - 1; index++) {
      const start = route.route[index]!
      if (start.toNextSegmentType !== "through_obstacle") continue
      const end = route.route[index + 1]!
      const validBridge = ownership.connectedObstaclesByRoute[routeIndex]!.some((obstacle) => {
        const layers = obstacle.__zLayers ?? obstacle.zLayers ??
          obstacle.layers.map((layer) => mapLayerNameToZ(layer, layerCount))
        return layers.length > 1 && layers.includes(start.z) && layers.includes(end.z) &&
          obstacleContainsPoint(obstacle, start) && obstacleContainsPoint(obstacle, end)
      })
      if (!validBridge) return false
    }
  }
  const groups = new Map<string, NodeWithPortPoints["portPoints"]>()
  for (const port of node.portPoints) {
    const ports = groups.get(port.connectionName) ?? []
    ports.push(port)
    groups.set(port.connectionName, ports)
  }
  const srj: SimpleRouteJson = {
    layerCount,
    minTraceWidth: params.traceWidth,
    minViaDiameter: params.viaDiameter,
    bounds: {
      minX: node.center.x - node.width / 2,
      maxX: node.center.x + node.width / 2,
      minY: node.center.y - node.height / 2,
      maxY: node.center.y + node.height / 2,
    },
    ...params.boardGeometry,
    obstacles: obstacles.map((obstacle, index) => ({
      ...obstacle,
      connectedTo: [...obstacle.connectedTo, ...ownership.connectedRouteNamesByObstacle[index]!],
    })),
    connections: [...groups].map(([name, ports]) => ({
      name,
      rootConnectionName: ports[0]!.rootConnectionName,
      pointsToConnect: ports.map((port) => ({
        x: port.x,
        y: port.y,
        layer: mapZToLayerName(port.z, layerCount),
        pcb_port_id: port.pcb_port_id,
      })),
    })),
  }
  const traces = routes.map((route, index) => ({
    type: "pcb_trace" as const,
    pcb_trace_id: `learning_${index}`,
    connection_name: route.connectionName,
    route: convertHdRouteToSimplifiedRoute(route, layerCount),
  }))
  const circuitJson = convertToCircuitJson(srj, traces)
  if (params.boardGeometry) circuitJson.push(createPcbBoardElement(srj))
  const { errors } = getDrcErrors(circuitJson, {
    traceClearance: params.obstacleMargin,
    viaClearance: params.obstacleMargin,
    // Mesh interfaces intentionally end without a PCB pad. The port graph
    // check above verifies the node's complete electrical contract instead.
    includeTraceContinuity: false,
  })
  return errors.length === 0 &&
    getFixedObstacleViolations({
      srj: { ...srj, traces: undefined },
      routes,
      traceClearance: params.obstacleMargin,
      viaClearance: clearance,
    }).length === 0
}
