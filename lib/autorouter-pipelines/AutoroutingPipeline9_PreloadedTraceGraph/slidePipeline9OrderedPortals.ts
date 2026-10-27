import type { NodeWithPortPoints, PortPoint } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types/srj-types"
import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { HighDensityBoardGeometry } from "lib/types/high-density-board-geometry"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import { minimumDistanceBetweenSegments } from "lib/utils/minimumDistanceBetweenSegments"
import { isPointInOrOnPolygon } from "lib/utils/polygonContainment"
import { getSharedEdgeForNodePair } from "../../solvers/UniformPortDistributionSolver/getSharedEdgeForNodePair"
import type { Bounds, SharedEdge } from "../../solvers/UniformPortDistributionSolver/types"
import { Pipeline9StraightCellCertifier, type Pipeline9PhysicalTerminal } from "./certifyPipeline9StraightCell"

export type Pipeline9OrderedPortalStats = {
  sharedSeamCount: number
  eligiblePortalCount: number
  movedPortalCount: number
  acceptedRunCount: number
  blockedPortalCount: number
  physicalTerminalCount: number
  insufficientWidthRunCount: number
  displacement: number
  straightLengthBefore: number
  straightLengthAfter: number
  nominalWidthPortalCount: number
  maxReservedTraceWidth: number
  widthRepairRunCount: number
  boardClearanceRejectedRunCount: number
  totalPairLengthBefore: number
  totalPairLengthAfter: number
  certifiedRunCount: number
  certifiedCellCount: number
  certificateRejectedRunCount: number
  certificateRejectionReasons: Record<string, number>
  witnessNeighborCellChecks: number
}

type Portal = {
  point: PortPoint
  copies: PortPoint[]
  remote: [PortPoint, PortPoint] | undefined
  coordinate: number
  lower: number
  upper: number
  target: number
  width: number
}

type IsotonicBlock = { start: number; end: number; sum: number; count: number; lower: number; upper: number; value: number }
type PhysicalTerminal = Pipeline9PhysicalTerminal
const EPSILON = 1e-8

/** Project all lanes together: subtract their required pitch, pool adjacent
 * violations, and restore pitch. This solves the bounded convex least-squares
 * allocation without sampling possible portal coordinates. */
export const allocateOrderedPortalCoordinates = ({
  targets,
  lower,
  upper,
  pitch,
  separations,
  lowerBounds,
  upperBounds,
}: {
  targets: readonly number[]
  lower: number
  upper: number
  pitch: number
  separations?: readonly number[]
  lowerBounds?: readonly number[]
  upperBounds?: readonly number[]
}): number[] | undefined => {
  if (!targets.length) return []
  if (!Number.isFinite(pitch) || pitch < 0 || targets.some((target) => !Number.isFinite(target)) ||
    (separations && (separations.length !== targets.length - 1 || separations.some((gap) => !Number.isFinite(gap) || gap < 0))) ||
    (lowerBounds && lowerBounds.length !== targets.length) || (upperBounds && upperBounds.length !== targets.length)) {
    throw new Error("Invalid ordered-portal allocation contract")
  }
  const offsets = [0]
  for (let index = 1; index < targets.length; index++) offsets.push(offsets[index - 1]! + (separations?.[index - 1] ?? pitch))
  const blocks: IsotonicBlock[] = []
  for (const [index, target] of targets.entries()) {
    const blockLower = (lowerBounds?.[index] ?? lower) - offsets[index]!
    const blockUpper = (upperBounds?.[index] ?? upper) - offsets[index]!
    if (blockLower > blockUpper + EPSILON) return undefined
    const sum = target - offsets[index]!
    blocks.push({ start: index, end: index, sum, count: 1, lower: blockLower, upper: blockUpper, value: Math.max(blockLower, Math.min(blockUpper, sum)) })
    while (blocks.length > 1) {
      const right = blocks[blocks.length - 1]!
      const left = blocks[blocks.length - 2]!
      if (left.value <= right.value) break
      const blockLower = Math.max(left.lower, right.lower)
      const blockUpper = Math.min(left.upper, right.upper)
      if (blockLower > blockUpper + EPSILON) return undefined
      const sum = left.sum + right.sum
      const count = left.count + right.count
      blocks.splice(blocks.length - 2, 2, {
        start: left.start,
        end: right.end,
        sum, count, lower: blockLower, upper: blockUpper,
        value: Math.max(blockLower, Math.min(blockUpper, sum / count)),
      })
    }
  }
  const coordinates = new Array<number>(targets.length)
  for (const block of blocks) {
    for (let index = block.start; index <= block.end; index++) {
      coordinates[index] = block.value + offsets[index]!
    }
  }
  return coordinates
}

const getRemotePoint = (node: NodeWithPortPoints, point: PortPoint): PortPoint | undefined => {
  if (!node.portPointsInPairs) return undefined
  const pairs = node.portPointsInPairs.filter((pair) =>
    pair.some((entry) => entry.portPointId === point.portPointId),
  )
  if (pairs.length !== 1) return undefined
  const pair = pairs[0]!
  const remote = pair[0].portPointId === point.portPointId ? pair[1] : pair[0]
  if (remote.connectionName !== point.connectionName || remote.z !== point.z) return undefined
  return remote
}

const getPortal = ({
  point,
  copies,
  nodes,
  edge,
  obstacles,
  physicalTerminals,
  layerCount,
  padding,
  width,
  holeClearance,
  stats,
}: {
  point: PortPoint
  copies: PortPoint[]
  nodes: [NodeWithPortPoints, NodeWithPortPoints]
  edge: SharedEdge
  obstacles: Obstacle[]
  physicalTerminals: readonly PhysicalTerminal[]
  layerCount: number
  padding: number
  width: number
  holeClearance: number
  stats: Pipeline9OrderedPortalStats
}): Portal => {
  const vertical = edge.orientation === "vertical"
  const coordinate = vertical ? point.y : point.x
  let lower = (vertical ? edge.y1 : edge.x1) + padding
  let upper = (vertical ? edge.y2 : edge.x2) - padding
  let remote: Portal["remote"]
  const terminal = copies.some((copy) => copy.pcb_port_id !== undefined) ||
    physicalTerminals.some((terminal) => terminal.z === point.z &&
      Math.abs(terminal.x - point.x) < EPSILON && Math.abs(terminal.y - point.y) < EPSILON)
  if (terminal) stats.physicalTerminalCount++
  if (!terminal && copies.every((copy) => copy.x === point.x && copy.y === point.y &&
    copy.z === point.z && copy.connectionName === point.connectionName && copy.rootConnectionName === point.rootConnectionName)) {
    const a = getRemotePoint(nodes[0], point)
    const b = getRemotePoint(nodes[1], point)
    if (a && b) remote = [a, b]
  }
  // Conservative expanded obstacle boxes partition the seam into free portal
  // intervals. A portal stays inside its existing component of that free space.
  for (const obstacle of obstacles) {
    const layers = obstacle.zLayers ?? obstacle.layers.map((layer) => mapLayerNameToZ(layer, layerCount))
    if (!layers.includes(point.z)) continue
    const obstaclePadding = obstacle.isNonPlatedHole ? Math.max(padding, width / 2 + holeClearance) : padding
    const angle = (obstacle.ccwRotationDegrees ?? 0) * Math.PI / 180
    const halfX = (Math.abs(Math.cos(angle)) * obstacle.width + Math.abs(Math.sin(angle)) * obstacle.height) / 2 + obstaclePadding
    const halfY = (Math.abs(Math.sin(angle)) * obstacle.width + Math.abs(Math.cos(angle)) * obstacle.height) / 2 + obstaclePadding
    const acrossDistance = vertical ? Math.abs(edge.x1 - obstacle.center.x) : Math.abs(edge.y1 - obstacle.center.y)
    if (acrossDistance > (vertical ? halfX : halfY) + EPSILON) continue
    const middle = vertical ? obstacle.center.y : obstacle.center.x
    const radius = vertical ? halfY : halfX
    if (coordinate > middle + radius + EPSILON) lower = Math.max(lower, middle + radius)
    else if (coordinate < middle - radius - EPSILON) upper = Math.min(upper, middle - radius)
    else remote = undefined
  }
  let target = coordinate
  if (remote) {
    const aAcross = vertical ? remote[0].x - edge.x1 : remote[0].y - edge.y1
    const bAcross = vertical ? remote[1].x - edge.x1 : remote[1].y - edge.y1
    // Endpoints must lie strictly on opposite sides. Boundary-following
    // connections need a different contract and remain fixed here.
    if (aAcross * bAcross >= -EPSILON || coordinate < lower || coordinate > upper) remote = undefined
    else {
      const aAlong = vertical ? remote[0].y : remote[0].x
      const bAlong = vertical ? remote[1].y : remote[1].x
      target = (aAlong * Math.abs(bAcross) + bAlong * Math.abs(aAcross)) / (Math.abs(aAcross) + Math.abs(bAcross))
      stats.eligiblePortalCount++
    }
  }
  if (!remote && !terminal) stats.blockedPortalCount++
  return { point, copies, remote, coordinate, lower, upper, target, width }
}

/** Keep boundary permutation and topology fixed, but jointly optimize the
 * physical crossings of each seam. Both owners receive the same coordinates.
 * Width, fixed contacts and obstacle intervals are hard constraints; the native
 * high-density router still constructs and validates all physical copper. */
export const slidePipeline9OrderedPortals = ({
  nodes,
  obstacles,
  physicalTerminals,
  layerCount,
  traceWidth,
  traceWidthByConnectionName,
  clearance,
  minTraceToHoleEdgeClearance,
  boardGeometry,
  connMap,
  requireStraightCellWitness = true,
  enabled = true,
}: {
  nodes: NodeWithPortPoints[]
  obstacles: Obstacle[]
  physicalTerminals: readonly PhysicalTerminal[]
  layerCount: number
  traceWidth: number
  traceWidthByConnectionName?: ReadonlyMap<string, number>
  clearance: number
  minTraceToHoleEdgeClearance?: number
  boardGeometry?: HighDensityBoardGeometry
  connMap?: ConnectivityMap
  requireStraightCellWitness?: boolean
  enabled?: boolean
}): { nodes: NodeWithPortPoints[]; stats: Pipeline9OrderedPortalStats } => {
  const stats: Pipeline9OrderedPortalStats = {
    sharedSeamCount: 0, eligiblePortalCount: 0, movedPortalCount: 0,
    acceptedRunCount: 0, blockedPortalCount: 0, physicalTerminalCount: 0,
    insufficientWidthRunCount: 0, displacement: 0,
    straightLengthBefore: 0, straightLengthAfter: 0,
    nominalWidthPortalCount: 0, maxReservedTraceWidth: traceWidth,
    widthRepairRunCount: 0,
    boardClearanceRejectedRunCount: 0,
    totalPairLengthBefore: 0, totalPairLengthAfter: 0,
    certifiedRunCount: 0, certifiedCellCount: 0, certificateRejectedRunCount: 0, certificateRejectionReasons: {}, witnessNeighborCellChecks: 0,
  }
  if (!enabled) return { nodes, stats }
  if (!(traceWidth > 0) || !(clearance >= 0)) throw new Error("Ordered portals require positive width and nonnegative clearance")
  const output = structuredClone(nodes)
  const certifier = requireStraightCellWitness ? new Pipeline9StraightCellCertifier({
    obstacles, physicalTerminals, layerCount, traceWidth, traceWidthByConnectionName, clearance,
    minTraceToHoleEdgeClearance, boardGeometry, connMap,
  }) : undefined
  const certifiedCellIds = new Set<string>()
  const witnessNeighborMargin = Math.max(traceWidth, ...(traceWidthByConnectionName?.values() ?? [])) + clearance
  for (const node of output) for (const [start, end] of node.portPointsInPairs ?? []) {
    stats.totalPairLengthBefore += Math.hypot(start.x - end.x, start.y - end.y)
  }
  const byId = new Map<string, NodeWithPortPoints>()
  const bounds = new Map<string, Bounds>()
  const owners = new Map<string, Set<string>>()
  for (const node of output) {
    if (byId.has(node.capacityMeshNodeId)) throw new Error(`Duplicate ordered-portal node ${node.capacityMeshNodeId}`)
    byId.set(node.capacityMeshNodeId, node)
    bounds.set(node.capacityMeshNodeId, {
      minX: node.center.x - node.width / 2, maxX: node.center.x + node.width / 2,
      minY: node.center.y - node.height / 2, maxY: node.center.y + node.height / 2,
    })
    for (const point of node.portPoints) {
      if (!point.portPointId) continue
      const ids = owners.get(point.portPointId) ?? new Set<string>()
      ids.add(node.capacityMeshNodeId)
      owners.set(point.portPointId, ids)
    }
  }
  const seams = new Map<string, SharedEdge>()
  for (const ids of owners.values()) {
    if (ids.size !== 2) continue
    const [nodeAId, nodeBId] = [...ids].sort() as [string, string]
    const edge = getSharedEdgeForNodePair({ nodeAId, nodeBId, nodeBounds: bounds })
    if (edge) seams.set(edge.ownerPairKey, edge)
  }
  const pitch = traceWidth + clearance
  const boardPolygon = boardGeometry?.outline && boardGeometry.outline.length >= 3 ? boardGeometry.outline : boardGeometry ? [
    { x: boardGeometry.bounds.minX, y: boardGeometry.bounds.minY },
    { x: boardGeometry.bounds.maxX, y: boardGeometry.bounds.minY },
    { x: boardGeometry.bounds.maxX, y: boardGeometry.bounds.maxY },
    { x: boardGeometry.bounds.minX, y: boardGeometry.bounds.maxY },
  ] : undefined
  for (const edge of [...seams.values()].sort((a, b) => a.ownerPairKey.localeCompare(b.ownerPairKey))) {
    stats.sharedSeamCount++
    const ownerNodes = edge.ownerNodeIds.map((id) => byId.get(id)!) as [NodeWithPortPoints, NodeWithPortPoints]
    const allPoints = ownerNodes.flatMap((node) => [...node.portPoints, ...(node.portPointsInPairs?.flat() ?? [])])
    const contacts = new Map<string, PortPoint[]>()
    for (const point of allPoints) {
      const along = edge.orientation === "vertical" ? point.y : point.x
      const across = edge.orientation === "vertical" ? point.x - edge.x1 : point.y - edge.y1
      if (Math.abs(across) > EPSILON || along < (edge.orientation === "vertical" ? edge.y1 : edge.x1) - EPSILON ||
        along > (edge.orientation === "vertical" ? edge.y2 : edge.x2) + EPSILON) continue
      const key = point.portPointId ?? JSON.stringify([point.connectionName, point.x, point.y, point.z])
      const copies = contacts.get(key) ?? []
      if (!copies.includes(point)) copies.push(point)
      contacts.set(key, copies)
    }
    const layers = new Map<number, Portal[]>()
    for (const copies of contacts.values()) {
      const point = copies[0]!
      const width = Math.max(traceWidth, traceWidthByConnectionName?.get(point.connectionName) ??
        (point.rootConnectionName ? traceWidthByConnectionName?.get(point.rootConnectionName) : undefined) ?? traceWidth)
      if (width > traceWidth) stats.nominalWidthPortalCount++
      stats.maxReservedTraceWidth = Math.max(stats.maxReservedTraceWidth, width)
      const portal = getPortal({ point, copies, nodes: ownerNodes, edge, obstacles, physicalTerminals, layerCount, padding: width / 2 + clearance, width,
        holeClearance: minTraceToHoleEdgeClearance ?? clearance, stats })
      if (!point.portPointId || owners.get(point.portPointId)?.size !== 2 ||
        !ownerNodes.every((node) => node.portPoints.some((entry) => entry.portPointId === point.portPointId))) {
        if (portal.remote) stats.eligiblePortalCount--
        portal.remote = undefined
      }
      const layer = layers.get(point.z) ?? []
      layer.push(portal)
      layers.set(point.z, layer)
    }
    for (const layer of layers.values()) {
      layer.sort((a, b) => a.coordinate - b.coordinate || (a.point.portPointId ?? "").localeCompare(b.point.portPointId ?? ""))
      for (let first = 0; first < layer.length;) {
        const initial = layer[first]!
        if (!initial.remote) { first++; continue }
        let last = first
        while (last + 1 < layer.length && layer[last + 1]!.remote) last++
        const run = layer.slice(first, last + 1)
        const lowerBounds = run.map((portal) => portal.lower)
        const upperBounds = run.map((portal) => portal.upper)
        if (first > 0) lowerBounds[0] = Math.max(lowerBounds[0]!, layer[first - 1]!.coordinate + (layer[first - 1]!.width + initial.width) / 2 + clearance)
        if (last + 1 < layer.length) upperBounds[run.length - 1] = Math.min(upperBounds[run.length - 1]!, layer[last + 1]!.coordinate - (layer[last + 1]!.width + run[run.length - 1]!.width) / 2 - clearance)
        const coordinates = allocateOrderedPortalCoordinates({ targets: run.map((portal) => portal.target), lower: -Infinity, upper: Infinity, lowerBounds, upperBounds, pitch,
          separations: run.slice(1).map((portal, index) => (run[index]!.width + portal.width) / 2 + clearance),
        })
        if (!coordinates) { stats.insufficientWidthRunCount++; first = last + 1; continue }
        if (boardPolygon && run.some((portal, index) => {
          const proposed = edge.orientation === "vertical" ? { x: portal.point.x, y: coordinates[index]! } : { x: coordinates[index]!, y: portal.point.y }
          const radius = portal.width / 2 + (boardGeometry!.minBoardEdgeClearance ?? 0)
          return !isPointInOrOnPolygon(proposed, boardPolygon) || boardPolygon.some((start, edgeIndex) =>
            minimumDistanceBetweenSegments(portal.point, proposed, start, boardPolygon[(edgeIndex + 1) % boardPolygon.length]!) < radius - EPSILON,
          )
        })) {
          stats.boardClearanceRejectedRunCount++
          first = last + 1
          continue
        }
        const repairsWidth = run.some((portal, index) =>
          portal.coordinate < lowerBounds[index]! - EPSILON || portal.coordinate > upperBounds[index]! + EPSILON ||
          (index > 0 && portal.coordinate - run[index - 1]!.coordinate < (portal.width + run[index - 1]!.width) / 2 + clearance - EPSILON),
        )
        let before = 0
        let after = 0
        for (const [index, portal] of run.entries()) {
          for (const remote of portal.remote!) {
            before += Math.hypot(portal.point.x - remote.x, portal.point.y - remote.y)
            const x = edge.orientation === "vertical" ? portal.point.x : coordinates[index]!
            const y = edge.orientation === "vertical" ? coordinates[index]! : portal.point.y
            after += Math.hypot(x - remote.x, y - remote.y)
          }
        }
        stats.straightLengthBefore += before
        stats.straightLengthAfter += before
        // Repair a deficient requested-width contract first. Otherwise the
        // actual two-cell polyline length decides whether to commit the
        // squared-distance projection's proposed coordinates.
        if (repairsWidth || after < before - EPSILON) {
          if (certifier) {
            const proposed = new Map(run.map((portal, index) => [portal.point.portPointId!, edge.orientation === "vertical" ?
              { x: portal.point.x, y: coordinates[index]! } : { x: coordinates[index]!, y: portal.point.y }]))
            // A later BC transaction must not invalidate an earlier AB
            // witness. Reconstruct nearby previously certified cells from
            // current coordinates and include them in the same transaction.
            const neighbors = output.filter((node) => {
              if (!certifiedCellIds.has(node.capacityMeshNodeId) || ownerNodes.includes(node)) return false
              return ownerNodes.some((owner) =>
                Math.abs(owner.center.x - node.center.x) <= (owner.width + node.width) / 2 + witnessNeighborMargin &&
                Math.abs(owner.center.y - node.center.y) <= (owner.height + node.height) / 2 + witnessNeighborMargin,
              )
            })
            stats.witnessNeighborCellChecks += neighbors.length
            const certificate = certifier.certifyJointNodes([...ownerNodes, ...neighbors], proposed)
            if (!certificate.certified) {
              stats.certificateRejectedRunCount++
              stats.certificateRejectionReasons[certificate.reason] = (stats.certificateRejectionReasons[certificate.reason] ?? 0) + 1
              first = last + 1
              continue
            }
            stats.certifiedRunCount++
            for (const node of ownerNodes) certifiedCellIds.add(node.capacityMeshNodeId)
          }
          stats.acceptedRunCount++
          if (repairsWidth) stats.widthRepairRunCount++
          stats.straightLengthAfter += after - before
          for (const [index, portal] of run.entries()) {
            const coordinate = coordinates[index]!
            const displacement = Math.abs(coordinate - portal.coordinate)
            if (displacement <= EPSILON) continue
            stats.movedPortalCount++
            stats.displacement += displacement
            for (const copy of portal.copies) {
              if (edge.orientation === "vertical") copy.y = coordinate
              else copy.x = coordinate
            }
            portal.coordinate = coordinate
          }
        }
        first = last + 1
      }
    }
  }
  for (const node of output) for (const [start, end] of node.portPointsInPairs ?? []) {
    stats.totalPairLengthAfter += Math.hypot(start.x - end.x, start.y - end.y)
  }
  stats.certifiedCellCount = certifiedCellIds.size
  return { nodes: output, stats }
}
