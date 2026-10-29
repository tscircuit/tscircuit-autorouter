import type { CapacityMeshNode, Obstacle, SimpleRouteJson } from "lib/types"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import type { SharedEdgeSegment } from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import { getSharedEdgeForNodePair } from "lib/solvers/UniformPortDistributionSolver/getSharedEdgeForNodePair"
import type { Bounds, SharedEdge } from "lib/solvers/UniformPortDistributionSolver/types"
import { mapZToLayerName } from "lib/utils/mapZToLayerName"
import { PIPELINE9_DUPLICATE_PORT_PROXIMITY } from "lib/solvers/PortPointPathingSolver/tinyhypergraph/TinyHypergraphPortPointPathingSolver"

type Point = { x: number; y: number }

export type Pipeline9GeometryFeedbackStats = {
  activated: boolean
  audits: number
  families: number
  certificates: number
  cuts: number
  replans: number
  unknown: number
  feasible: number
  unsupported: number
  primaryIterations: number
  primaryIterationBudget: number
  replanIterationBudget: number
  replanIterations: number
  constructorCalls: number
}

export type Pipeline9GeometryCertificate = {
  familyKey: string
  z: number
  sourcePortLayerKeys: string[]
  reason: "outside-original-board" | "inside-non-plated-hole"
  obstacleIndex?: number
  // This is a superset of every possible crossing position: the full physical
  // shared edge, retained source ports, and all native duplicate displacements.
  movementBounds: Bounds
}

export type Pipeline9BoundaryFeasibility =
  | { kind: "proved-infeasible"; certificate: Pipeline9GeometryCertificate }
  | { kind: "feasible-crossing-witness"; familyKey: string; witness: Point }
  | { kind: "unknown"; familyKey: string; reason: string }

export type Pipeline9GeometryFeedbackAudit = {
  outcomes: Pipeline9BoundaryFeasibility[]
  certificates: Pipeline9GeometryCertificate[]
  usedCertificateCount: number
}

type Family = {
  key: string
  nodeIds: [string, string]
  z: number
  sourcePortLayerKeys: string[]
  sourcePoints: Point[]
  hasFixedAssignments: boolean
}

type Solid = {
  obstacle: Obstacle
  kind: "rect" | "inscribed-circle" | "unknown"
  index: number
  cos: number
  sin: number
  halfWidth: number
  halfHeight: number
  bounds: Bounds
}

export const createPipeline9GeometryFeedbackStats = (): Pipeline9GeometryFeedbackStats => ({
  activated: false,
  audits: 0,
  families: 0,
  certificates: 0,
  cuts: 0,
  replans: 0,
  unknown: 0,
  feasible: 0,
  unsupported: 0,
  primaryIterations: 0,
  primaryIterationBudget: 0,
  replanIterationBudget: 0,
  replanIterations: 0,
  constructorCalls: 0,
})

export const getPipeline9GeometryFamilyKey = (
  firstNodeId: string,
  secondNodeId: string,
  z: number,
): string => JSON.stringify(
  firstNodeId < secondNodeId
    ? [firstNodeId, secondNodeId, z]
    : [secondNodeId, firstNodeId, z],
)

const getFamilies = (segments: SharedEdgeSegment[]): Family[] => {
  const families = new Map<string, Family>()
  const familyBySourcePortLayer = new Map<string, string>()
  for (const segment of segments) {
    for (const port of segment.portPoints) {
      for (const z of port.availableZ) {
        const key = getPipeline9GeometryFamilyKey(...port.nodeIds, z)
        const sourceKey = `${port.segmentPortPointId}::${z}`
        const existingFamily = familyBySourcePortLayer.get(sourceKey)
        if (existingFamily !== undefined && existingFamily !== key) {
          throw new Error("Geometry feedback requires globally unique source port-layer identities")
        }
        familyBySourcePortLayer.set(sourceKey, key)
        let family = families.get(key)
        if (!family) {
          family = {
            key, nodeIds: port.nodeIds[0] < port.nodeIds[1]
              ? [port.nodeIds[0], port.nodeIds[1]] : [port.nodeIds[1], port.nodeIds[0]],
            z, sourcePoints: [],
            sourcePortLayerKeys: [], hasFixedAssignments: false,
          }
          families.set(key, family)
        }
        family.sourcePoints.push({ x: port.x, y: port.y })
        family.sourcePortLayerKeys.push(sourceKey)
        family.hasFixedAssignments ||= Boolean(
          port._preloadedTracePortAssignments?.length || port._preloadedFixedNetIds?.length,
        )
      }
    }
  }
  return [...families.values()]
}

const getMovementBounds = (family: Family, edge: SharedEdge): Bounds => {
  // DuplicateCongestedPortSolver normalizes its displacement direction and
  // uses proximity * i / (count + 1), strictly less than this shared constant.
  // Redistribution uses the full shared edge; ignored ports keep their source
  // positions. Both sets must be covered, even when no duplicate was used yet.
  const radius = PIPELINE9_DUPLICATE_PORT_PROXIMITY
  const bounds = {
    minX: Math.min(edge.x1, edge.x2), maxX: Math.max(edge.x1, edge.x2),
    minY: Math.min(edge.y1, edge.y2), maxY: Math.max(edge.y1, edge.y2),
  }
  for (const point of family.sourcePoints) {
    bounds.minX = Math.min(bounds.minX, point.x - radius)
    bounds.maxX = Math.max(bounds.maxX, point.x + radius)
    bounds.minY = Math.min(bounds.minY, point.y - radius)
    bounds.maxY = Math.max(bounds.maxY, point.y + radius)
  }
  return bounds
}

const getSolids = (obstacles: Obstacle[]): Solid[] => {
  const solids: Solid[] = []
  for (const [index, obstacle] of obstacles.entries()) {
    const angle = (obstacle.ccwRotationDegrees ?? 0) * Math.PI / 180
    if (![obstacle.center.x, obstacle.center.y, obstacle.width, obstacle.height, angle].every(Number.isFinite) ||
      obstacle.width <= 0 || obstacle.height <= 0) continue
    const cos = Math.cos(angle), sin = Math.sin(angle)
    // Legacy datasets can carry runtime oval/type/shape fields beyond today's
    // TS interface. A bounding rectangle is not an inner body of those shapes.
    const type: string = obstacle.type
    const shape: unknown = obstacle.shape
    // Legacy plated/via squares are exported as round copper, including some
    // single-layer fragments. Their provenance must not control routing. The
    // inscribed circle is valid for both that body and an actual SMT rectangle.
    const ambiguousSquare = !obstacle.isNonPlatedHole && Math.abs(obstacle.width - obstacle.height) < 0.001
    const kind = type === "rect" && (shape === undefined || shape === "rect")
      ? ambiguousSquare ? "inscribed-circle" as const : "rect" as const
      : ((type === "rect" || type === "circle") && shape === "circle") ||
          ((type === "circle" || type === "oval") && shape === undefined)
        ? "inscribed-circle" as const
        : "unknown" as const
    const halfWidth = obstacle.width / 2, halfHeight = obstacle.height / 2
    const extentX = Math.abs(cos) * halfWidth + Math.abs(sin) * halfHeight
    const extentY = Math.abs(sin) * halfWidth + Math.abs(cos) * halfHeight
    solids.push({
      obstacle, kind, index, cos, sin, halfWidth, halfHeight,
      bounds: {
        minX: obstacle.center.x - extentX, maxX: obstacle.center.x + extentX,
        minY: obstacle.center.y - extentY, maxY: obstacle.center.y + extentY,
      },
    })
  }
  return solids
}

const wholeDomainInsideSolid = (bounds: Bounds, solid: Solid): boolean => {
  // Strict interior of one convex body is a sufficient proof. Nominal node
  // capacity, obstacle bounding-box overlap, or a grid timeout are not proofs.
  if (solid.kind === "unknown") return false
  const margin = 1e-8 * Math.max(1, solid.halfWidth, solid.halfHeight)
  const corners = [
    { x: bounds.minX, y: bounds.minY }, { x: bounds.minX, y: bounds.maxY },
    { x: bounds.maxX, y: bounds.minY }, { x: bounds.maxX, y: bounds.maxY },
  ]
  return corners.every((point) => {
    const dx = point.x - solid.obstacle.center.x
    const dy = point.y - solid.obstacle.center.y
    // For NPTHs use the common inscribed disk of every supported centered
    // rectangular/round/oval interpretation, including legacy shape ambiguity.
    if (solid.kind === "inscribed-circle" || solid.obstacle.isNonPlatedHole) {
      const radius = Math.min(solid.halfWidth, solid.halfHeight) - margin
      return radius > 0 && dx * dx + dy * dy < radius * radius
    }
    const x = dx * solid.cos + dy * solid.sin
    const y = -dx * solid.sin + dy * solid.cos
    return Math.abs(x) < solid.halfWidth - margin &&
      Math.abs(y) < solid.halfHeight - margin
  })
}

const appliesToLayer = (obstacle: Obstacle, z: number, layerCount: number): boolean => {
  if (obstacle.isNonPlatedHole) return true
  if (obstacle.__zLayers !== undefined) return obstacle.__zLayers.includes(z)
  if (obstacle.zLayers !== undefined) return obstacle.zLayers.includes(z)
  return obstacle.layers.includes(mapZToLayerName(z, layerCount))
}

const getCrossingWitness = (
  edge: SharedEdge,
  z: number,
  srj: SimpleRouteJson,
  solids: Solid[],
): Point | undefined => {
  // A witness certifies only a legal crossing point, never an entire detailed
  // route. Conservative outer boxes keep unsupported pad shapes/ownership from
  // producing false witnesses. Polygon outlines remain unknown in this probe.
  if (srj.outline?.length || solids.length !== srj.obstacles.length ||
    solids.some((solid) => solid.kind === "unknown") ||
    !Object.values(srj.bounds).every(Number.isFinite) ||
    !Number.isFinite(srj.minTraceWidth) || srj.minTraceWidth <= 0) return undefined
  const radius = srj.minTraceWidth / 2
  const edgeMargin = radius + (srj.minBoardEdgeClearance ?? 0)
  const clearance = Math.max(srj.minTraceToPadEdgeClearance ?? 0,
    srj.minTraceToHoleEdgeClearance ?? 0, srj.defaultObstacleMargin ?? 0.15)
  for (const point of [edge.center, { x: edge.x1, y: edge.y1 }, { x: edge.x2, y: edge.y2 }]) {
    if (point.x <= srj.bounds.minX + edgeMargin || point.x >= srj.bounds.maxX - edgeMargin ||
      point.y <= srj.bounds.minY + edgeMargin || point.y >= srj.bounds.maxY - edgeMargin) continue
    const blocked = solids.some((solid) => appliesToLayer(solid.obstacle, z, srj.layerCount) &&
      point.x >= solid.bounds.minX - radius - clearance && point.x <= solid.bounds.maxX + radius + clearance &&
      point.y >= solid.bounds.minY - radius - clearance && point.y <= solid.bounds.maxY + radius + clearance)
    if (!blocked) return point
  }
  return undefined
}

/** Audits crossing-coordinate domains, not nominal detailed-routing rectangles. */
export const auditPipeline9GeometryFeedback = ({
  srj, nodes, segments, assignedNodes, stats,
}: {
  srj: SimpleRouteJson
  nodes: CapacityMeshNode[]
  segments: SharedEdgeSegment[]
  assignedNodes: NodeWithPortPoints[]
  stats: Pipeline9GeometryFeedbackStats
}): Pipeline9GeometryFeedbackAudit => {
  stats.activated = true
  stats.audits++
  const families = getFamilies(segments)
  const boundsByNodeId = new Map(nodes.map((node) => [node.capacityMeshNodeId, {
    minX: node.center.x - node.width / 2, maxX: node.center.x + node.width / 2,
    minY: node.center.y - node.height / 2, maxY: node.center.y + node.height / 2,
  }]))
  const nodesByPortId = new Map<string, { nodeIds: Set<string>; z: number; x: number; y: number }>()
  for (const node of assignedNodes) {
    for (const port of node.portPoints) {
      if (!port.portPointId) continue
      const existing = nodesByPortId.get(port.portPointId)
      if (existing && (existing.z !== port.z || existing.x !== port.x || existing.y !== port.y)) {
        throw new Error("Geometry feedback requires shared port replicas to agree on physical XYZ")
      }
      const entry = existing ?? { nodeIds: new Set<string>(), z: port.z, x: port.x, y: port.y }
      entry.nodeIds.add(node.capacityMeshNodeId)
      nodesByPortId.set(port.portPointId, entry)
    }
  }
  const usedFamilies = new Set<string>()
  for (const entry of nodesByPortId.values()) {
    if (entry.nodeIds.size !== 2) continue
    const [first, second] = [...entry.nodeIds]
    usedFamilies.add(getPipeline9GeometryFamilyKey(first!, second!, entry.z))
  }
  const solids = getSolids(srj.obstacles)
  const hasOffBoardConnections = srj.connections.some((connection) => connection.isOffBoard) ||
    srj.obstacles.some((obstacle) => Boolean(obstacle.offBoardConnectsTo?.length))
  const offBoardNodeIds = new Set(nodes.filter((node) => node._offBoardConnectionId !== undefined ||
    Boolean(node._offBoardConnectedCapacityMeshNodeIds?.length)).map((node) => node.capacityMeshNodeId))
  // Do not assume a producer's nominal bounds contain its original outline.
  // A point outside this union envelope is outside either interpretation.
  const boardEnvelope = { ...srj.bounds }
  for (const point of srj.outline ?? []) {
    boardEnvelope.minX = Math.min(boardEnvelope.minX, point.x)
    boardEnvelope.maxX = Math.max(boardEnvelope.maxX, point.x)
    boardEnvelope.minY = Math.min(boardEnvelope.minY, point.y)
    boardEnvelope.maxY = Math.max(boardEnvelope.maxY, point.y)
  }
  const outcomes: Pipeline9BoundaryFeasibility[] = []
  for (const family of families) {
    stats.families++
    const edge = getSharedEdgeForNodePair({
      nodeAId: family.nodeIds[0], nodeBId: family.nodeIds[1], nodeBounds: boundsByNodeId,
    })
    // Two-layer redistribution grows node bounds to selected endpoints. That
    // assignment-dependent domain cannot be replaced by a nominal rectangle.
    if (srj.layerCount <= 2 || family.hasFixedAssignments || !edge ||
      family.nodeIds.some((id) => offBoardNodeIds.has(id)) ||
      srj.allowJumpers || Boolean(srj.jumpers?.length) ||
      !Number.isInteger(family.z) || family.z < 0 || family.z >= srj.layerCount ||
      family.sourcePoints.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
      stats.unknown++; stats.unsupported++
      outcomes.push({ kind: "unknown", familyKey: family.key, reason: "uncertified-coordinate-domain" })
      continue
    }
    const movementBounds = getMovementBounds(family, edge)
    let certificate: Pipeline9GeometryCertificate | undefined
    if (!hasOffBoardConnections && Object.values(boardEnvelope).every(Number.isFinite) && (
      movementBounds.maxX < boardEnvelope.minX - 1e-8 || movementBounds.minX > boardEnvelope.maxX + 1e-8 ||
      movementBounds.maxY < boardEnvelope.minY - 1e-8 || movementBounds.minY > boardEnvelope.maxY + 1e-8
    )) {
      certificate = {
        familyKey: family.key, z: family.z, sourcePortLayerKeys: family.sourcePortLayerKeys,
        reason: "outside-original-board", movementBounds,
      }
    } else {
      for (const solid of solids) {
        const obstacle = solid.obstacle
        // Empty connectedTo is not proof of absent electrical ownership:
        // imported ports/legacy aliases can still connect copper to a net.
        // Only a non-plated hole is an unconditional physical solid here.
        // All copper-pad restrictions require a net-scoped ownership oracle.
        if (!obstacle.isNonPlatedHole || obstacle.connectedTo.length !== 0 || obstacle.netIsAssignable || obstacle.isCopperPour ||
          !appliesToLayer(obstacle, family.z, srj.layerCount) ||
          !wholeDomainInsideSolid(movementBounds, solid)) continue
        certificate = {
          familyKey: family.key, z: family.z, sourcePortLayerKeys: family.sourcePortLayerKeys,
          reason: "inside-non-plated-hole", obstacleIndex: solid.index, movementBounds,
        }
        break
      }
    }
    if (certificate) {
      stats.certificates++
      outcomes.push({ kind: "proved-infeasible", certificate })
      continue
    }
    const witness = getCrossingWitness(edge, family.z, srj, solids)
    if (witness) {
      stats.feasible++
      outcomes.push({ kind: "feasible-crossing-witness", familyKey: family.key, witness })
    } else {
      stats.unknown++
      outcomes.push({ kind: "unknown", familyKey: family.key, reason: "no-certificate-or-witness" })
    }
  }
  const certificates = outcomes.flatMap((outcome) => outcome.kind === "proved-infeasible" ? [outcome.certificate] : [])
  return {
    outcomes, certificates,
    usedCertificateCount: certificates.filter((certificate) => usedFamilies.has(certificate.familyKey)).length,
  }
}
