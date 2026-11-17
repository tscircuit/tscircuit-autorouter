import assert from "node:assert/strict"

type Data = Record<string, any>
type Point = { x: number; y: number; z?: number }
type Wire = { start: Point; end: Point; z: number; width: number }
type Via = { center: Point; minZ: number; maxZ: number; diameter: number }
type Copper = { wireSegments: Wire[]; viaSpans: Via[] }
type Helpers = {
  getPipeline9RouteCopperGeometry: (route: Data, board: Data) => Copper
  doPipeline9RoutesHaveCopperConflict: (input: Data) => boolean
  arePipeline9RoutesOnSameNet: (left: Data, right: Data, connMap: Data) => boolean
  isPipeline9ObstacleConnectedToRoute: (input: Data) => boolean
  minimumDistanceBetweenSegments: (a: Point, b: Point, c: Point, d: Point) => number
}
type Context = {
  helpers: Helpers
  mergedNode: Data
  parentParams: Data
  connMap: Data
  absorbedNodeIds: Iterable<string>
  originalNodes: Data[]
  pendingNodeIds: string[]
  acceptedRoutes: Data[]
  immutablePreloadRoutes: Data[]
  candidateRoutes: Data[]
  boardCircuitJson: Data[]
}
type Validation = {
  valid: boolean
  failureCounts: Record<string, number>
  firstFailures: Data[]
  checked: Data
}

// Only geometric roundoff is tolerated; all dimensional rules remain native.
const EPSILON = 1e-9

const samePoint = (left: Point, right: Point): boolean => {
  return (
    Math.abs(left.x - right.x) <= EPSILON &&
    Math.abs(left.y - right.y) <= EPSILON &&
    left.z === right.z
  )
}

/** Exact segment distance to a round pad or an arbitrarily rotated rectangle. */
const segmentObstacleDistance = ({ start, end, obstacle, helpers }: {
  start: Point; end: Point; obstacle: Data; helpers: Helpers
}): number => {
  if (obstacle.shape === "circle") {
    return Math.max(0, helpers.minimumDistanceBetweenSegments(start, end, obstacle.center, obstacle.center) - obstacle.width / 2)
  }
  assert(obstacle.shape === undefined || obstacle.shape === "rect", "Unsupported board obstacle shape")
  const angle = -(obstacle.ccwRotationDegrees ?? 0) * Math.PI / 180
  const transform = (point: Point): Point => {
    const x = point.x - obstacle.center.x
    const y = point.y - obstacle.center.y
    return { x: x * Math.cos(angle) - y * Math.sin(angle), y: x * Math.sin(angle) + y * Math.cos(angle) }
  }
  const a = transform(start)
  const b = transform(end)
  const halfWidth = obstacle.width / 2
  const halfHeight = obstacle.height / 2
  if ([a, b].some(point => Math.abs(point.x) <= halfWidth && Math.abs(point.y) <= halfHeight)) return 0
  const corners = [
    { x: -halfWidth, y: -halfHeight }, { x: halfWidth, y: -halfHeight },
    { x: halfWidth, y: halfHeight }, { x: -halfWidth, y: halfHeight },
  ]
  return Math.min(...corners.map((corner, index) => helpers.minimumDistanceBetweenSegments(a, b, corner, corners[(index + 1) % 4]!)))
}

/** Distance from a via center to the real circle/slot drill boundary. */
const pointHoleDistance = (point: Point, hole: Data): number => {
  const shape = hole.hole_shape ?? hole.shape
  if (shape === "circle") {
    assert(Number.isFinite(hole.hole_diameter) && hole.hole_diameter > 0, "Missing real circular drill diameter")
    return Math.max(0, Math.hypot(point.x - hole.x, point.y - hole.y) - hole.hole_diameter / 2)
  }
  assert(shape === "pill", "Unsupported mechanical hole shape")
  assert(Number.isFinite(hole.hole_width) && hole.hole_width > 0 && Number.isFinite(hole.hole_height) && hole.hole_height > 0, "Missing real slot drill dimensions")
  const angle = -(hole.ccw_rotation ?? 0) * Math.PI / 180
  const dx = point.x - hole.x
  const dy = point.y - hole.y
  const x = dx * Math.cos(angle) - dy * Math.sin(angle)
  const y = dx * Math.sin(angle) + dy * Math.cos(angle)
  const radius = Math.min(hole.hole_width, hole.hole_height) / 2
  const extent = Math.abs(hole.hole_width - hole.hole_height) / 2
  const distance = hole.hole_width >= hole.hole_height
    ? Math.hypot(Math.max(0, Math.abs(x) - extent), y)
    : Math.hypot(x, Math.max(0, Math.abs(y) - extent))
  return Math.max(0, distance - radius)
}

/** Diagnostic acceptance only: never modifies solver input or routed copper. */
export const validateH616RegionalCut = (context: Context): Validation => {
  const { helpers, mergedNode, parentParams, connMap, originalNodes, acceptedRoutes, immutablePreloadRoutes, boardCircuitJson } = context
  // Cleanup can mutate a route in place; native copper helpers cache by identity.
  const candidateRoutes = context.candidateRoutes.map(route => structuredClone(route))
  const absorbed = new Set(context.absorbedNodeIds)
  const pendingIds = new Set(context.pendingNodeIds)
  const sameNet = (left: Data, right: Data): boolean => helpers.arePipeline9RoutesOnSameNet(left, right, connMap)
  const failureCounts: Record<string, number> = {}
  const firstFailures: Data[] = []
  const fail = (kind: string, detail: Data): void => {
    failureCounts[kind] = (failureCounts[kind] ?? 0) + 1
    if (firstFailures.length < 24) firstFailures.push({ kind, ...detail })
  }
  for (const key of ["layerCount", "traceWidth", "viaDiameter", "viaHoleDiameter", "minViaHoleEdgeToViaHoleEdgeClearance", "obstacleMargin", "minClearance", "viaCopperClearance", "viaToPadClearance"]) {
    assert(Number.isFinite(parentParams[key]) && parentParams[key] >= 0, `Missing native rule ${key}`)
  }
  assert(parentParams.allowBlindAndBuriedVias !== true, "This screen requires the captured through-via policy")
  const board = { layerCount: parentParams.layerCount, allowBlindAndBuriedVias: false }
  const copperClearance = Math.max(parentParams.obstacleMargin, parentParams.minClearance, parentParams.viaCopperClearance)
  const wirePadClearance = Math.max(parentParams.obstacleMargin, parentParams.minClearance)
  const finitePoint = (point: any): boolean => point !== null && typeof point === "object" && Number.isFinite(point.x) && Number.isFinite(point.y)
  for (const route of candidateRoutes) {
    if (!Number.isFinite(route.traceThickness) || route.traceThickness <= 0 || !Number.isFinite(route.viaDiameter) || route.viaDiameter <= 0) fail("invalid_copper_dimensions", { connection: route.connectionName, traceThickness: route.traceThickness, viaDiameter: route.viaDiameter })
    if (!Array.isArray(route.route) || route.route.length < 2 || !route.route.every((point: Data) => finitePoint(point) && Number.isInteger(point.z) && point.z >= 0 && point.z < parentParams.layerCount && (point.traceThickness === undefined || (Number.isFinite(point.traceThickness) && point.traceThickness > 0)))) fail("invalid_route_points", { connection: route.connectionName })
    if (!Array.isArray(route.vias) || !route.vias.every(finitePoint)) fail("invalid_explicit_vias", { connection: route.connectionName })
  }
  if (Object.keys(failureCounts).length > 0) return { valid: false, failureCounts, firstFailures, checked: { candidateRoutes: candidateRoutes.length, geometryHelpersCalled: false } }
  const geometry = candidateRoutes.map(route => helpers.getPipeline9RouteCopperGeometry(route, board))
  const immutableRoutes = [...acceptedRoutes, ...immutablePreloadRoutes]
  const immutableGeometry = immutableRoutes.map(route => helpers.getPipeline9RouteCopperGeometry(route, board))
  for (const copper of [...geometry, ...immutableGeometry]) {
    assert(Array.isArray(copper.wireSegments) && Array.isArray(copper.viaSpans), "Native copper helper returned invalid collections")
    assert(copper.wireSegments.every(wire => finitePoint(wire.start) && finitePoint(wire.end) && Number.isFinite(wire.width) && wire.width > 0 && Number.isInteger(wire.z) && wire.z >= 0 && wire.z < parentParams.layerCount), "Native copper helper returned invalid wire geometry")
    assert(copper.viaSpans.every(via => finitePoint(via.center) && Number.isFinite(via.diameter) && via.diameter > 0 && Number.isInteger(via.minZ) && Number.isInteger(via.maxZ) && via.minZ >= 0 && via.minZ <= via.maxZ && via.maxZ < parentParams.layerCount), "Native copper helper returned invalid via geometry")
  }
  for (let index = 0; index < geometry.length; index++) {
    const connection = candidateRoutes[index]!.connectionName
    for (const wire of geometry[index]!.wireSegments) if (wire.width + EPSILON < parentParams.traceWidth) fail("scaled_wire_geometry", { connection, width: wire.width, required: parentParams.traceWidth })
    for (const via of geometry[index]!.viaSpans) if (via.diameter + EPSILON < parentParams.viaDiameter) fail("scaled_via_geometry", { connection, diameter: via.diameter, required: parentParams.viaDiameter })
  }

  const originalPorts = new Map<string, (Point & Data)[]>()
  for (const node of originalNodes.filter(node => absorbed.has(node.capacityMeshNodeId))) {
    for (const port of node.portPoints) {
      assert(typeof port.portPointId === "string", "Absorbed node contains an unidentified port")
      const copies = originalPorts.get(port.portPointId) ?? []
      copies.push(port)
      originalPorts.set(port.portPointId, copies)
    }
  }
  for (const [id, copies] of originalPorts) {
    const first = copies[0]!
    if (copies.length === 2 && copies.every(port => !port.pcb_port_id)) {
      if (!copies.every(port => samePoint(port, first) && port.connectionName === first.connectionName && sameNet(port, first))) fail("interior_anchor_identity", { portPointId: id })
      if (mergedNode.portPoints.some((port: Data) => port.portPointId === id)) fail("interior_anchor_retained", { portPointId: id })
      continue
    }
    const retained = mergedNode.portPoints.filter((port: Data) => port.portPointId === id)
    if (retained.length !== 1 || !samePoint(retained[0], first) || retained[0].connectionName !== first.connectionName || retained[0].pcb_port_id !== first.pcb_port_id || !sameNet(retained[0], first)) fail("outer_anchor_identity", { portPointId: id })
  }

  // Route endpoint ownership remains exact even if same-net route pieces merge.
  const routeParents = candidateRoutes.map((_, index) => index)
  const allowedConnections = new Set(mergedNode.portPoints.map((port: Data) => port.connectionName))
  const canonicalNet = (id: string): string | undefined => connMap.idToNetMap?.[id] ?? (connMap.netMap && Object.hasOwn(connMap.netMap, id) ? id : undefined)
  const bounds = {
    minX: mergedNode.center.x - mergedNode.width / 2,
    maxX: mergedNode.center.x + mergedNode.width / 2,
    minY: mergedNode.center.y - mergedNode.height / 2,
    maxY: mergedNode.center.y + mergedNode.height / 2,
  }
  const root = (index: number): number => {
    while (routeParents[index] !== index) index = routeParents[index]!
    return index
  }
  for (let left = 0; left < candidateRoutes.length; left++) {
    const route = candidateRoutes[left]!
    if (!allowedConnections.has(route.connectionName)) fail("unexpected_connection", { connection: route.connectionName })
    if (route.rootConnectionName !== undefined) {
      const inputPorts = mergedNode.portPoints.filter((port: Data) => port.connectionName === route.connectionName)
      const aliases = new Set<string>(inputPorts.flatMap((port: Data) => [port.connectionName, port.rootConnectionName].filter((id: unknown) => typeof id === "string")))
      const nets = new Set([...aliases].map(canonicalNet).filter((id): id is string => id !== undefined))
      const rootNet = typeof route.rootConnectionName === "string" ? canonicalNet(route.rootConnectionName) : undefined
      if (typeof route.rootConnectionName !== "string" || (rootNet !== undefined && nets.size > 0 ? !nets.has(rootNet) : !aliases.has(route.rootConnectionName))) fail("inconsistent_root_connection", { connection: route.connectionName, rootConnection: route.rootConnectionName, inputAliases: [...aliases] })
    }
    if (!Array.isArray(route.route) || route.route.length < 2) fail("invalid_route", { connection: route.connectionName })
    if (route.traceThickness + EPSILON < parentParams.traceWidth || route.viaDiameter + EPSILON < parentParams.viaDiameter) fail("scaled_copper", { connection: route.connectionName, traceThickness: route.traceThickness, viaDiameter: route.viaDiameter })
    for (const point of route.route) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isInteger(point.z) || point.z < 0 || point.z >= parentParams.layerCount) fail("invalid_point", { connection: route.connectionName, point })
      if (point.x < bounds.minX - EPSILON || point.x > bounds.maxX + EPSILON || point.y < bounds.minY - EPSILON || point.y > bounds.maxY + EPSILON) fail("outside_merged_node", { connection: route.connectionName, point })
      if (point.toNextSegmentType === "through_obstacle") fail("unexpected_new_through_obstacle", { connection: route.connectionName })
    }
    for (let right = left + 1; right < candidateRoutes.length; right++) {
      if (sameNet(route, candidateRoutes[right]!)) {
        if (helpers.doPipeline9RoutesHaveCopperConflict({ left: route, right: candidateRoutes[right], clearance: EPSILON, ...board })) routeParents[root(right)] = root(left)
      } else if (helpers.doPipeline9RoutesHaveCopperConflict({ left: route, right: candidateRoutes[right], clearance: copperClearance, ...board })) fail("candidate_copper_conflict", { left: route.connectionName, right: candidateRoutes[right]!.connectionName })
    }
    for (const other of immutableRoutes) {
      if (!sameNet(route, other) && helpers.doPipeline9RoutesHaveCopperConflict({ left: route, right: other, clearance: copperClearance, ...board })) fail("immutable_copper_conflict", { candidate: route.connectionName, immutable: other.connectionName })
    }
  }
  const endpointOwners = (port: Point & Data): number[] => candidateRoutes.flatMap((route, index) => {
    if (!sameNet(port, route)) return []
    const endpoints = [route.route[0], route.route.at(-1)]
    return endpoints.some(point => point && samePoint(point, port)) ? [root(index)] : []
  })
  for (const port of mergedNode.portPoints) {
    if (endpointOwners(port).length === 0) fail("missing_endpoint", { portPointId: port.portPointId, connection: port.connectionName })
  }
  for (const [start, end] of mergedNode.portPointsInPairs) {
    const starts = new Set(endpointOwners(start))
    if (!endpointOwners(end).some(owner => starts.has(owner))) fail("disconnected_port_pair", { connection: start.connectionName, start: start.portPointId, end: end.portPointId })
  }

  const pendingNodes = originalNodes.filter(node => pendingIds.has(node.capacityMeshNodeId) && !absorbed.has(node.capacityMeshNodeId))
  for (let index = 0; index < candidateRoutes.length; index++) {
    const route = candidateRoutes[index]!
    const copper = geometry[index]!
    for (const obstacle of parentParams.obstacles) {
      const layers = obstacle.__zLayers ?? obstacle.zLayers
      assert(Array.isArray(layers), "Native obstacle lacks captured layer identity")
      if (helpers.isPipeline9ObstacleConnectedToRoute({ obstacle, route, connMap })) continue
      for (const wire of copper.wireSegments) {
        if (!layers.includes(wire.z)) continue
        const clearance = segmentObstacleDistance({ start: wire.start, end: wire.end, obstacle, helpers }) - wire.width / 2
        if (clearance + EPSILON < wirePadClearance) fail("wire_pad_clearance", { connection: route.connectionName, obstacle: obstacle.circuitJsonMetadata ?? obstacle.obstacleId, clearance, required: wirePadClearance })
      }
      for (const via of copper.viaSpans) {
        if (!layers.some((z: number) => z >= via.minZ && z <= via.maxZ)) continue
        const clearance = segmentObstacleDistance({ start: via.center, end: via.center, obstacle, helpers }) - via.diameter / 2
        if (clearance + EPSILON < parentParams.viaToPadClearance) fail("via_pad_clearance", { connection: route.connectionName, obstacle: obstacle.circuitJsonMetadata ?? obstacle.obstacleId, clearance, required: parentParams.viaToPadClearance })
      }
    }
    for (const node of pendingNodes) {
      const foreignLayers = new Set<number>()
      for (const [start, end] of node.portPointsInPairs) {
        if (sameNet(route, start) && sameNet(route, end)) continue
        if (start.z === end.z) foreignLayers.add(start.z)
        else for (let z = 0; z < parentParams.layerCount; z++) foreignLayers.add(z)
      }
      if (foreignLayers.size === 0) continue
      const rectangle = { center: node.center, width: node.width, height: node.height }
      for (const wire of copper.wireSegments) {
        if (foreignLayers.has(wire.z) && segmentObstacleDistance({ start: wire.start, end: wire.end, obstacle: rectangle, helpers }) + EPSILON < wire.width / 2) fail("foreign_pending_wire_domain", { connection: route.connectionName, node: node.capacityMeshNodeId, z: wire.z })
      }
      for (const via of copper.viaSpans) {
        if ([...foreignLayers].some(z => z >= via.minZ && z <= via.maxZ) && segmentObstacleDistance({ start: via.center, end: via.center, obstacle: rectangle, helpers }) + EPSILON < via.diameter / 2) fail("foreign_pending_via_domain", { connection: route.connectionName, node: node.capacityMeshNodeId, minZ: via.minZ, maxZ: via.maxZ })
      }
    }
  }

  const publishedVias = boardCircuitJson.filter(item => item.type === "pcb_via")
  assert(publishedVias.every(via => via.hole_diameter === parentParams.viaHoleDiameter), "Immutable via drill diameters require per-hole qualification")
  const boardHoles = boardCircuitJson.filter(item => item.type === "pcb_hole" || item.type === "pcb_plated_hole")
  const candidateVias = geometry.flatMap((copper, index) => copper.viaSpans.map(via => ({ via, route: candidateRoutes[index]! })))
  const immutableVias = immutableGeometry.flatMap((copper, index) => copper.viaSpans.flatMap(via => {
    const route = immutableRoutes[index]!
    // A component-owned through-obstacle primitive is not a newly drilled via.
    const realVia = route.vias.some((point: Point) => point.x === via.center.x && point.y === via.center.y) || route.route.some((point: Point & Data, at: number) => at + 1 < route.route.length && point.z !== route.route[at + 1].z && point.toNextSegmentType !== "through_obstacle" && [point, route.route[at + 1]].some(endpoint => endpoint.x === via.center.x && endpoint.y === via.center.y))
    return realVia ? [{ via, route }] : []
  }))
  for (let index = 0; index < candidateVias.length; index++) {
    const current = candidateVias[index]!
    if (current.via.minZ !== 0 || current.via.maxZ !== parentParams.layerCount - 1) fail("non_through_via", { connection: current.route.connectionName, via: current.via })
    for (const other of [...candidateVias.slice(index + 1), ...immutableVias]) {
      if (current.via.center.x === other.via.center.x && current.via.center.y === other.via.center.y && sameNet(current.route, other.route)) continue
      const clearance = Math.hypot(current.via.center.x - other.via.center.x, current.via.center.y - other.via.center.y) - parentParams.viaHoleDiameter
      if (clearance + EPSILON < parentParams.minViaHoleEdgeToViaHoleEdgeClearance) fail("via_hole_spacing", { connection: current.route.connectionName, other: other.route.connectionName, center: current.via.center, otherCenter: other.via.center, clearance, required: parentParams.minViaHoleEdgeToViaHoleEdgeClearance })
    }
    for (const hole of boardHoles) {
      const exactSameHole = hole.type === "pcb_plated_hole" && (hole.hole_shape ?? hole.shape) === "circle" && hole.x === current.via.center.x && hole.y === current.via.center.y && hole.hole_diameter === parentParams.viaHoleDiameter && sameNet(current.route, { connectionName: hole.pcb_plated_hole_id })
      if (exactSameHole) continue
      const clearance = pointHoleDistance(current.via.center, hole) - parentParams.viaHoleDiameter / 2
      if (clearance + EPSILON < parentParams.minViaHoleEdgeToViaHoleEdgeClearance) fail("via_board_hole_spacing", { connection: current.route.connectionName, hole: hole.pcb_plated_hole_id ?? hole.pcb_hole_id, clearance, required: parentParams.minViaHoleEdgeToViaHoleEdgeClearance })
    }
  }
  return {
    valid: Object.keys(failureCounts).length === 0,
    failureCounts,
    firstFailures,
    checked: { candidateRoutes: candidateRoutes.length, immutableRoutes: immutableRoutes.length, pendingNodes: pendingNodes.length, candidateVias: candidateVias.length, immutableVias: immutableVias.length, boardHoles: boardHoles.length, copperClearance, wirePadClearance, viaPadClearance: parentParams.viaToPadClearance, mechanicalHoleClearance: parentParams.minViaHoleEdgeToViaHoleEdgeClearance, noBlindVias: true, geometricRoundoffTolerance: EPSILON },
  }
}
