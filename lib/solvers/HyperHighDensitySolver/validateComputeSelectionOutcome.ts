import RBush from "rbush"
import { getPipeline9RouteCopperGeometry } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9FixedRouteCopper"
import { getCanonicalPipeline9PortRoot } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getCanonicalPipeline9PortRoot"
import { isPipeline9ObstacleOwnedByRoute } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/isPipeline9ObstacleOwnedByRoute"
import { pointToSegmentDistance, segmentToBoundsMinDistance } from "@tscircuit/math-utils"
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
  validationScope?: "local-structure" | "physical"
  copperRules?: Pick<SimpleRouteJson, "allowBlindAndBuriedVias" | "allowViaInPad" | "defaultObstacleMargin" | "minTraceToPadEdgeClearance" | "minTraceToHoleEdgeClearance" | "minViaEdgeToPadEdgeClearance">
}

type CopperSegment = {
  start: HighDensityRoute["route"][number]
  end: HighDensityRoute["route"][number]
  root: string
  routeIndex: number
  minX: number
  minY: number
  maxX: number
  maxY: number
}

const hasDeclaredObstacleClearance = (
  params: ValidationParams,
  obstacles: Obstacle[],
  connectedObstaclesByRoute: Obstacle[][],
): boolean => {
  const rules = params.copperRules ?? {}
  for (const [routeIndex, route] of params.routes.entries()) {
    const geometry = getPipeline9RouteCopperGeometry(route, {
      layerCount: params.layerCount,
      allowBlindAndBuriedVias: rules.allowBlindAndBuriedVias,
    })
    const manufacturedViaSites = new Set(route.vias.map((via) => `${via.x},${via.y}`))
    for (let index = 1; index < route.route.length; index++) {
      const a = route.route[index - 1]!, b = route.route[index]!
      if (a.z !== b.z && a.toNextSegmentType !== "through_obstacle") {
        manufacturedViaSites.add(`${a.x},${a.y}`)
      }
    }
    const owned = new Set(connectedObstaclesByRoute[routeIndex])
    for (const obstacle of obstacles) {
      const layers = obstacle.__zLayers ?? obstacle.zLayers ??
        obstacle.layers.map((layer) => mapLayerNameToZ(layer, params.layerCount))
      if (layers.some((z) => !Number.isInteger(z) || z < 0 || z >= params.layerCount)) {
        throw new Error("Physical candidate diagnostic received an invalid obstacle layer")
      }
      const sameNet = !obstacle.isNonPlatedHole && owned.has(obstacle)
      const rotation = -(obstacle.ccwRotationDegrees ?? 0) * Math.PI / 180
      const toLocal = (point: { x: number; y: number }): { x: number; y: number } => {
        const x = point.x - obstacle.center.x, y = point.y - obstacle.center.y
        return { x: x * Math.cos(rotation) - y * Math.sin(rotation), y: x * Math.sin(rotation) + y * Math.cos(rotation) }
      }
      const distance = (a: { x: number; y: number }, b: { x: number; y: number }): number => {
        const start = toLocal(a), end = toLocal(b)
        if (obstacle.shape === "circle") {
          if (Math.abs(obstacle.width - obstacle.height) > 1e-8) {
            throw new Error("Physical circle obstacle requires equal diameters")
          }
          return Math.max(0, pointToSegmentDistance({ x: 0, y: 0 }, start, end) - obstacle.width / 2)
        }
        return segmentToBoundsMinDistance(start, end, {
          minX: -obstacle.width / 2, maxX: obstacle.width / 2,
          minY: -obstacle.height / 2, maxY: obstacle.height / 2,
        })
      }
      const wireGap = obstacle.isNonPlatedHole && rules.minTraceToHoleEdgeClearance !== undefined
        ? rules.minTraceToHoleEdgeClearance
        : Math.max(params.obstacleMargin, rules.defaultObstacleMargin ?? 0, rules.minTraceToPadEdgeClearance ?? 0)
      if (!sameNet && geometry.wireSegments.some((wire) => layers.includes(wire.z) &&
        distance(wire.start, wire.end) + 1e-8 < wire.width / 2 + wireGap)) return false
      for (const via of geometry.viaSpans) {
        if (!layers.some((z) => z >= via.minZ && z <= via.maxZ)) continue
        const manufactured = manufacturedViaSites.has(`${via.center.x},${via.center.y}`)
        // A certified through-pad electrical bridge is existing pad copper,
        // rather than a manufactured via. Explicit via sites remain checked.
        if (sameNet && (!manufactured || rules.allowViaInPad || obstacle.isCopperPour)) continue
        const gap = Math.max(
          sameNet ? 0 : params.obstacleMargin,
          rules.defaultObstacleMargin ?? 0,
          rules.minViaEdgeToPadEdgeClearance ?? 0,
        )
        if (distance(via.center, via.center) + 1e-8 < via.diameter / 2 + gap) return false
      }
    }
  }
  return true
}

const hasRequiredPortConnectivity = ({
  routes,
  node,
  connMap,
  layerCount,
  copperRules,
}: ValidationParams): boolean => {
  const getRoot = (owner: Pick<HighDensityRoute, "connectionName" | "rootConnectionName">): string => connMap ? getCanonicalPipeline9PortRoot(owner, connMap) : owner.rootConnectionName ?? owner.connectionName
  // Every polyline is internally connected by construction. Union route
  // components only where distinct same-net copper actually touches; expanding
  // every pair of segments of one long grid path is unnecessary quadratic work.
  for (const route of routes) {
    if (route.route.length < 2 || route.route.some((point) => ![point.x, point.y, point.z].every(Number.isFinite) || !Number.isInteger(point.z) || point.z < 0 || point.z >= layerCount)) return false
    for (let i = 1; i < route.route.length; i++) {
      const a = route.route[i - 1]!
      const b = route.route[i]!
      if (a.z !== b.z && a.toNextSegmentType !== "through_obstacle" && Math.hypot(a.x - b.x, a.y - b.y) > 1e-6) return false
    }
  }
  const segments: CopperSegment[] = routes.flatMap((route, routeIndex) => {
    const root = getRoot(route)
    const geometry = getPipeline9RouteCopperGeometry(route, { layerCount, allowBlindAndBuriedVias: copperRules?.allowBlindAndBuriedVias })
    const wires = geometry.wireSegments.map((wire) => ({ start: wire.start, end: wire.end }))
    const vias = geometry.viaSpans.map((via) => ({ start: { ...via.center, z: via.minZ }, end: { ...via.center, z: via.maxZ } }))
    return [...wires, ...vias].map(({ start, end }) => ({ start, end, root, routeIndex, minX: Math.min(start.x, end.x) - 1e-6, maxX: Math.max(start.x, end.x) + 1e-6, minY: Math.min(start.y, end.y) - 1e-6, maxY: Math.max(start.y, end.y) + 1e-6 }))
  })
  const parent = routes.map((_, index) => index)
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
  const index = new RBush<CopperSegment>()
  for (const a of segments) {
    for (const b of index.search(a)) {
      if (a.root !== b.root || find(a.routeIndex) === find(b.routeIndex)) continue
      const minZ = Math.max(Math.min(a.start.z, a.end.z), Math.min(b.start.z, b.end.z))
      const maxZ = Math.min(Math.max(a.start.z, a.end.z), Math.max(b.start.z, b.end.z))
      if (minZ > maxZ || minimumDistanceBetweenSegments(a.start, a.end, b.start, b.end) > 1e-6) continue
      parent[find(a.routeIndex)] = find(b.routeIndex)
    }
    index.insert(a)
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
    const root = getRoot(port)
    const segment = index.search({ minX: port.x - 1e-6, maxX: port.x + 1e-6, minY: port.y - 1e-6, maxY: port.y + 1e-6 }).find((segment) =>
      segment.root === root &&
      port.z >= Math.min(segment.start.z, segment.end.z) &&
      port.z <= Math.max(segment.start.z, segment.end.z) &&
      pointToSegmentDistance(port, segment.start, segment.end) <= 1e-6,
    )
    if (!segment) return false
    components.set(`${port.connectionName}:${port.x}:${port.y}:${port.z}`, find(segment.routeIndex))
  }
  for (const [start, end] of pairs) {
    const from = components.get(`${start.connectionName}:${start.x}:${start.y}:${start.z}`)
    const to = components.get(`${end.connectionName}:${end.x}:${end.y}:${end.z}`)
    if (from === undefined || to === undefined || from !== to) return false
  }
  return true
}

export type ComputeSelectionAssessment = {
  structurallyValid: boolean
  physicallyClean: boolean
}

/** Assess the native local contract and physical label in one geometry pass. */
export const assessComputeSelectionOutcome = (params: ValidationParams): ComputeSelectionAssessment => {
  const { routes, node, layerCount, connMap } = params
  for (const name of ["defaultObstacleMargin", "minTraceToPadEdgeClearance", "minTraceToHoleEdgeClearance", "minViaEdgeToPadEdgeClearance"] as const) {
    const value = params.copperRules?.[name]
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
      throw new Error(`Physical candidate diagnostic received invalid ${name}`)
    }
  }
  for (const name of ["allowBlindAndBuriedVias", "allowViaInPad"] as const) {
    const value = params.copperRules?.[name]
    if (value !== undefined && typeof value !== "boolean") {
      throw new Error(`Physical candidate diagnostic received invalid ${name}`)
    }
  }
  if (![node.center.x, node.center.y, node.width, node.height, params.traceWidth, params.viaDiameter, params.obstacleMargin].every(Number.isFinite) || node.width <= 0 || node.height <= 0 || params.traceWidth <= 0 || params.viaDiameter <= 0 || params.obstacleMargin < 0 || !Number.isInteger(layerCount) || layerCount < 1 || node.portPoints.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isInteger(point.z) || point.z < 0 || point.z >= layerCount)) throw new Error("Detailed candidate validation requires finite geometry and valid physical rules")
  if (params.obstacles.some((obstacle) => ![obstacle.center.x, obstacle.center.y, obstacle.width, obstacle.height, obstacle.ccwRotationDegrees ?? 0].every(Number.isFinite) || obstacle.width < 0 || obstacle.height < 0)) throw new Error("Detailed candidate validation received malformed obstacle geometry")
  if (node.availableZ?.some((z) => !Number.isInteger(z) || z < 0 || z >= layerCount) || params.obstacles.some((obstacle) => (obstacle.__zLayers ?? obstacle.zLayers ?? obstacle.layers.map((layer) => mapLayerNameToZ(layer, layerCount))).some((z) => !Number.isInteger(z) || z < 0 || z >= layerCount))) throw new Error("Detailed candidate validation received invalid copper layers")
  for (const endpoint of node.portPointsInPairs?.flat() ?? []) {
    if (!Number.isFinite(endpoint.x) || !Number.isFinite(endpoint.y) || !Number.isInteger(endpoint.z) || endpoint.z < 0 || endpoint.z >= layerCount || !node.portPoints.some((port) =>
      (endpoint.portPointId === undefined || endpoint.portPointId === port.portPointId) &&
      endpoint.connectionName === port.connectionName && endpoint.pcb_port_id === port.pcb_port_id &&
      (endpoint.rootConnectionName ?? endpoint.connectionName) === (port.rootConnectionName ?? port.connectionName) &&
      endpoint.x === port.x && endpoint.y === port.y && endpoint.z === port.z,
    )) throw new Error("Detailed candidate validation lost an explicit interface witness")
  }
  if (params.boardGeometry && (!Object.values(params.boardGeometry.bounds).every(Number.isFinite) || params.boardGeometry.bounds.minX >= params.boardGeometry.bounds.maxX || params.boardGeometry.bounds.minY >= params.boardGeometry.bounds.maxY || !Number.isFinite(params.boardGeometry.minBoardEdgeClearance ?? 0.15) || (params.boardGeometry.minBoardEdgeClearance ?? 0.15) < 0 || params.boardGeometry.outline?.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y)))) throw new Error("Detailed candidate validation received malformed board geometry")
  if (routes.some((route) => !Number.isFinite(route.traceThickness) || route.traceThickness <= 0 || !Number.isFinite(route.viaDiameter) || route.viaDiameter <= 0 || route.vias.some((via) => !Number.isFinite(via.x) || !Number.isFinite(via.y)) || route.route.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isInteger(point.z) || point.z < 0 || point.z >= layerCount || point.traceThickness !== undefined && (!Number.isFinite(point.traceThickness) || point.traceThickness <= 0)))) throw new Error(`Detailed candidate kernel emitted malformed copper geometry in ${node.capacityMeshNodeId}: ${JSON.stringify(routes.map((route) => ({ name: route.connectionName, width: route.traceThickness, viaDiameter: route.viaDiameter, invalidPoints: route.route.filter((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isInteger(point.z) || point.z < 0 || point.z >= layerCount || point.traceThickness !== undefined && (!Number.isFinite(point.traceThickness) || point.traceThickness <= 0)), invalidVias: route.vias.filter((via) => !Number.isFinite(via.x) || !Number.isFinite(via.y)) })))}`)
  if (node.portPoints.length === 0 && routes.length === 0) return { structurallyValid: true, physicallyClean: true }
  if (routes.some((route) =>
    !Number.isFinite(route.traceThickness) ||
    route.traceThickness < params.traceWidth - 1e-9 ||
    !Number.isFinite(route.viaDiameter) ||
    route.viaDiameter < params.viaDiameter - 1e-9 ||
    route.route.some((point) => point.traceThickness !== undefined &&
      (!Number.isFinite(point.traceThickness) ||
        point.traceThickness < params.traceWidth - 1e-9)),
  )) return { structurallyValid: false, physicallyClean: false }
  if (!hasRequiredPortConnectivity(params)) return { structurallyValid: false, physicallyClean: false }
  const points = routes.flatMap((route) => route.route)
  const maxCopperWidth = Math.max(
    params.traceWidth,
    params.viaDiameter,
    ...routes.map((route) => Math.max(route.traceThickness, route.viaDiameter)),
    ...points.map((point) => point.traceThickness ?? 0),
  )
  const clearance = Math.max(params.obstacleMargin, MIN_VIA_TO_VIA_CLEARANCE,
    params.copperRules?.defaultObstacleMargin ?? 0,
    params.copperRules?.minTraceToPadEdgeClearance ?? 0,
    params.copperRules?.minTraceToHoleEdgeClearance ?? 0,
    params.copperRules?.minViaEdgeToPadEdgeClearance ?? 0)
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
  const ownership = getObstacleRouteConnectivity({ obstacles, routes, connMap,
    // The registered route connection proves its canonical owner. A root key
    // that also names a foreign ordinary alias cannot authorize pad copper.
    ...(connMap ? { isObstacleOwnedByRoute: (obstacle, route) => isPipeline9ObstacleOwnedByRoute(obstacle, route, connMap) } : {}),
  })
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
      if (!validBridge) return { structurallyValid: false, physicallyClean: false }
    }
  }
  if (params.validationScope === "local-structure") return { structurallyValid: true, physicallyClean: false }
  if (!hasDeclaredObstacleClearance(params, obstacles, ownership.connectedObstaclesByRoute)) return { structurallyValid: true, physicallyClean: false }
  const groups = new Map<string, NodeWithPortPoints["portPoints"]>()
  for (const port of node.portPoints) {
    const ports = groups.get(port.connectionName) ?? []
    ports.push(port)
    groups.set(port.connectionName, ports)
  }
  const srj: SimpleRouteJson = {
    ...params.copperRules,
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
    // Local mesh interfaces have no pad ID. Carry established board ownership
    // into Circuit JSON instead of inferring a net from terminal containment.
    connectsTo: [...new Set(ownership.connectedObstaclesByRoute[index]!.flatMap(
      (obstacle) => [...obstacle.connectedTo, ...(obstacle.circuitJsonMetadata?.pcb_port_id ? [obstacle.circuitJsonMetadata.pcb_port_id] : [])],
    ))],
    route: convertHdRouteToSimplifiedRoute(route, layerCount),
  }))
  const circuitJson = convertToCircuitJson(srj, traces)
  if (params.boardGeometry) circuitJson.push(createPcbBoardElement(srj))
  const { errors } = getDrcErrors(circuitJson, {
    traceClearance: params.obstacleMargin,
    viaClearance: params.obstacleMargin,
    holeClearance: params.copperRules?.minTraceToHoleEdgeClearance ?? params.obstacleMargin,
    // Mesh interfaces intentionally end without a PCB pad. The port graph
    // check above verifies the node's complete electrical contract instead.
    includeTraceContinuity: false,
  })
  return { structurallyValid: true, physicallyClean: errors.length === 0 }
}

/** Physical diagnostics never replace the later full-board acceptance check. */
export const validateComputeSelectionOutcome = (params: ValidationParams): boolean => {
  const assessment = assessComputeSelectionOutcome(params)
  if (params.validationScope === "local-structure") {
    return assessment.structurallyValid
  }
  return assessment.physicallyClean
}
