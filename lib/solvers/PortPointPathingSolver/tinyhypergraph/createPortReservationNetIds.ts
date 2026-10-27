import type { ConnectivityMap } from "circuit-json-to-connectivity-map"
import Flatbush from "flatbush"
import { isObstacleConnectedToRoute } from "lib/solvers/TraceWidthSolver/isObstacleConnectedToRoute"
import type { Obstacle, SimpleRouteConnection } from "lib/types"
import type { PortPoint } from "lib/types/high-density-types"
import { isOpaqueUnownedObstacle } from "lib/utils/isOpaqueUnownedObstacle"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"

export type PortReservationContext = {
  obstacles: readonly Obstacle[]
  connMap: ConnectivityMap
  traceWidth: number
  traceToPadClearance: number
  layerCount: number
}

export type PortReservationModel = {
  topology: {
    portCount: number
    portX: ArrayLike<number>
    portY: ArrayLike<number>
    portZ: ArrayLike<number>
  }
  problem: {
    routeNet: ArrayLike<number>
    routeMetadata?: readonly {
      connectionId?: string
      mutuallyConnectedNetworkId?: string
      simpleRouteConnection?: SimpleRouteConnection
    }[]
  }
}

type ReservationInput = PortReservationModel & { context: PortReservationContext }
type Point = { x: number; y: number; z: number }
type Pad = {
  obstacle: Obstacle
  layers: readonly number[]
  cosine: number
  sine: number
  shape: string
}
const EPSILON = 1e-9

/** Prepares exact physical pad geometry once for repeated point proposals. */
function createPadContactQuery(context: PortReservationContext): (point: Point) => readonly Obstacle[] {
  const margin = context.traceWidth / 2 + context.traceToPadClearance
  if (!Number.isFinite(context.traceWidth) || context.traceWidth <= 0 ||
    !Number.isFinite(context.traceToPadClearance) || context.traceToPadClearance < 0 ||
    !Number.isInteger(context.layerCount) || context.layerCount < 1) {
    throw new Error("Invalid physical port reservation geometry")
  }
  const pads: Pad[] = []
  for (const obstacle of context.obstacles) {
    if (obstacle.isNonPlatedHole || isOpaqueUnownedObstacle(obstacle)) continue
    const angle = (obstacle.ccwRotationDegrees ?? 0) * Math.PI / 180
    const shape: string = obstacle.shape ?? obstacle.type
    if (![obstacle.center.x, obstacle.center.y, obstacle.width, obstacle.height, angle].every(Number.isFinite) ||
      obstacle.width <= 0 || obstacle.height <= 0 || !["rect", "circle", "oval"].includes(shape) ||
      (shape === "circle" && Math.abs(obstacle.width - obstacle.height) > EPSILON)) {
      throw new Error("Unsupported physical pad geometry for port reservations")
    }
    const layers = obstacle.__zLayers ?? obstacle.zLayers ??
      obstacle.layers.map((layer) => mapLayerNameToZ(layer, context.layerCount))
    if (layers.length === 0 || layers.some((z) => !Number.isInteger(z) || z < 0 || z >= context.layerCount)) {
      throw new Error("Invalid physical pad layers for port reservations")
    }
    pads.push({ obstacle, layers, shape, cosine: Math.cos(angle), sine: Math.sin(angle) })
  }
  let index: Flatbush | undefined
  if (pads.length > 0) {
    index = new Flatbush(pads.length)
    for (const { obstacle, cosine, sine } of pads) {
      const halfX = (Math.abs(cosine) * obstacle.width + Math.abs(sine) * obstacle.height) / 2
      const halfY = (Math.abs(sine) * obstacle.width + Math.abs(cosine) * obstacle.height) / 2
      index.add(obstacle.center.x - halfX - margin, obstacle.center.y - halfY - margin,
        obstacle.center.x + halfX + margin, obstacle.center.y + halfY + margin)
    }
    index.finish()
  }
  return (point: Point): readonly Obstacle[] => {
    const { x, y, z } = point
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isInteger(z) || z < 0 || z >= context.layerCount) {
      throw new Error("Invalid final native port coordinates for physical reservations")
    }
    const contacts: Obstacle[] = []
    if (!index) return contacts
    for (const padIndex of index.search(x, y, x, y)) {
      const pad = pads[padIndex]!
      if (!pad.layers.includes(z)) continue
      const obstacle = pad.obstacle
      const dx = x - obstacle.center.x, dy = y - obstacle.center.y
      const px = dx * pad.cosine + dy * pad.sine
      const py = -dx * pad.sine + dy * pad.cosine
      const halfX = obstacle.width / 2, halfY = obstacle.height / 2
      let distance: number
      if (pad.shape === "circle") {
        distance = Math.max(0, Math.hypot(dx, dy) - halfX)
      } else if (pad.shape === "oval") {
        distance = halfX >= halfY
          ? Math.max(0, Math.hypot(Math.max(Math.abs(px) - (halfX - halfY), 0), py) - halfY)
          : Math.max(0, Math.hypot(px, Math.max(Math.abs(py) - (halfY - halfX), 0)) - halfX)
      } else {
        distance = Math.hypot(Math.max(Math.abs(px) - halfX, 0), Math.max(Math.abs(py) - halfY, 0))
      }
      if (distance + EPSILON < margin) contacts.push(obstacle)
    }
    return contacts
  }
}

/** Uses source connection identities for physical redistribution proposals. */
export function createPortPointPositionValidator(context: PortReservationContext): (point: PortPoint) => boolean {
  const getContacts = createPadContactQuery(context)
  return (point: PortPoint): boolean => {
    const contacts = getContacts(point)
    return contacts.every((obstacle) =>
      isObstacleConnectedToRoute(obstacle, point, context.connMap),
    )
  }
}

/** Reserves final native port copper footprints to their physical pad owner. */
export function createPortReservationNetIds(input: ReservationInput): Int32Array {
  const { topology, problem, context } = input
  const getContacts = createPadContactQuery(context)
  if (!problem.routeMetadata || problem.routeMetadata.length !== problem.routeNet.length) {
    throw new Error("Physical port reservations require native route ownership metadata")
  }
  const literalOwners = new Map<string, Set<number>>()
  const connectedOwners = new Map<string, Set<number>>()
  const recordOwner = (map: Map<string, Set<number>>, id: string, owner: number): void => {
    const owners = map.get(id) ?? new Set<number>()
    owners.add(owner)
    map.set(id, owners)
  }
  for (let routeId = 0; routeId < problem.routeNet.length; routeId++) {
    const owner = problem.routeNet[routeId]!
    const metadata = problem.routeMetadata[routeId]!
    if (!Number.isInteger(owner) || owner < 0 || !metadata) {
      throw new Error("Physical port reservations require a valid native route owner")
    }
    const connection = metadata.simpleRouteConnection
    const aliases = [metadata.connectionId, connection?.name, connection?.rootConnectionName,
      ...(connection?.__rootConnectionNames ?? []), ...(connection?.mergedConnectionNames ?? [])]
    for (const alias of aliases) {
      if (alias === undefined) continue
      recordOwner(literalOwners, alias, owner)
      const connectedNet = context.connMap.getNetConnectedToId(alias)
      if (connectedNet !== undefined) recordOwner(connectedOwners, connectedNet, owner)
    }
    // This is already a canonical net key, not another literal id to resolve.
    if (metadata.mutuallyConnectedNetworkId !== undefined) {
      recordOwner(connectedOwners, metadata.mutuallyConnectedNetworkId, owner)
    }
  }
  const padOwners = new Map<Obstacle, number>()
  for (const obstacle of context.obstacles) {
    if (obstacle.isNonPlatedHole || isOpaqueUnownedObstacle(obstacle)) continue
    const owners = new Set<number>()
    for (const id of obstacle.connectedTo) {
      for (const owner of literalOwners.get(id) ?? []) owners.add(owner)
      const connectedNet = context.connMap.getNetConnectedToId(id)
      if (connectedNet === undefined) continue
      for (const owner of connectedOwners.get(connectedNet) ?? []) owners.add(owner)
    }
    padOwners.set(obstacle, owners.size === 1 ? owners.values().next().value! : -2)
  }
  const reservations = new Int32Array(topology.portCount).fill(-1)
  for (let portId = 0; portId < topology.portCount; portId++) {
    const contacts = getContacts({ x: topology.portX[portId]!, y: topology.portY[portId]!, z: topology.portZ[portId]! })
    for (const obstacle of contacts) {
      const owner = padOwners.get(obstacle)!
      const previous = reservations[portId]!
      reservations[portId] = previous === -1 || previous === owner ? owner : -2
      if (reservations[portId] === -2) break
    }
  }
  return reservations
}
