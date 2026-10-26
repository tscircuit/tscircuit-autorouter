import Flatbush from "flatbush"
import type {
  TinyHyperGraphProblem,
  TinyHyperGraphRegionSegmentFeasibilityContext,
  TinyHyperGraphRegionSegmentFeasibilityResult,
  TinyHyperGraphTopology,
} from "tiny-hypergraph/lib/core"
import type {
  CapacityMeshNode,
  Obstacle,
  SimpleRouteConnection,
  SimpleRouteJson,
} from "lib/types"
import { createPipeline9StaticSegmentValidator } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9StaticSegmentValidator"
import { getPipeline9PhysicalGeometryContext } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/getPipeline9PhysicalGeometryContext"
import { canUseThroughViaCrosscut } from "./canUseThroughViaCrosscut"
import { shouldIgnoreSharedEdge } from "lib/solvers/UniformPortDistributionSolver/shouldIgnoreSharedEdge"
import type { EdgeInterval } from "lib/solvers/UniformPortDistributionSolver/getSharedEdgePhysicalIntervals"
import {
  getOrderedSharedEdgeFeasibility,
  type OrderedSharedEdgeEvent,
} from "./getOrderedSharedEdgeFeasibility"
import {
  getThroughViaCrosscutFeasibility,
  type ThroughViaDemand,
  type ThroughWireDemand,
} from "./getThroughViaCrosscutFeasibility"
import {
  getViaApproachCrosscutFeasibility,
  type CrosscutBoundaryContact,
  type ViaApproachDemand,
  type PlanarCrosscutDemand,
} from "./getViaApproachCrosscutFeasibility"
import { getNoViaPlanarCrossingFeasibility } from "./getNoViaPlanarCrossingFeasibility"
import { getUnequalViaDomainCrosscutFeasibility } from "./getUnequalViaDomainCrosscutFeasibility"
import { PhysicalSharedEdgePlacement } from "lib/solvers/UniformPortDistributionSolver/PhysicalSharedEdgePlacement"
import { getSharedEdgeForNodePair } from "lib/solvers/UniformPortDistributionSolver/getSharedEdgeForNodePair"
import type { SharedEdge as PhysicalSharedEdge } from "lib/solvers/UniformPortDistributionSolver/types"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { getViaDimensions } from "lib/utils/getViaDimensions"
import { isOpaqueUnownedObstacle } from "lib/utils/isOpaqueUnownedObstacle"

export type PhysicalViaCapacityContext = {
  physicalSrj: SimpleRouteJson
  freeRegionIds: string[]
  /** Actual producer rectangles eligible for physical shared-face proofs. */
  sharedEdgeRegionIds?: string[]
  /** Producer rectangles whose shared ports Uniform is permitted to move. */
  movableSharedEdgeRegionIds?: string[]
  planningObstacles?: Obstacle[]
  preserveSolitarySharedEdgePorts?: boolean
  /** Caller certifies fresh routing and the native rectangular routing domain. */
  throughViaCrosscutEnabled?: boolean
}

type Bounds = { minX: number; minY: number; maxX: number; maxY: number }
type PhysicalPad = Bounds & { owners: Set<string>; radius: number }
type ExistingConductor = Bounds & { owners: Set<string> }
type TraceDomain = { min: number; max: number; allowed: EdgeInterval[] }
type SharedEdge = {
  key: string
  z: number
  movable?: boolean
  blockedAnyLayer?: boolean
  lastOrdered?: {
    key: string
    result: TinyHyperGraphRegionSegmentFeasibilityResult
  }
  capacityOne: boolean
  geometry: PhysicalSharedEdge | null
  numericalSlack: number
  domainsByOwner: Map<string, Map<number, TraceDomain | null>>
}
type PhysicalBoard = {
  pads: PhysicalPad[]
  index?: Flatbush
  conductors: ExistingConductor[]
  conductorIndex?: Flatbush
  maximumRadius: number
  minimumCenterSpacing: number
  minimumTraceCenterSpacing: number
  minimumTraceWidth: number
  minimumViaPairSpacing: number
  minimumViaTraceRadius: number
  minimumSameOwnerViaSpacing: number
  sharedEdgePlacement: PhysicalSharedEdgePlacement
  sourceNameByOwner: Map<string, string>
  connMap: ReturnType<typeof getConnectivityMapFromSimpleRouteJson>
}
type RouteMetadata = {
  connectionId?: string
  simpleRouteConnection?: Partial<SimpleRouteConnection>
}
type Evaluator = (
  query: TinyHyperGraphRegionSegmentFeasibilityContext,
) => TinyHyperGraphRegionSegmentFeasibilityResult

const boardCache = new WeakMap<SimpleRouteJson, PhysicalBoard>()
const FEASIBLE: TinyHyperGraphRegionSegmentFeasibilityResult = {
  feasible: true,
}

function compilePhysicalBoard(physicalSrj: SimpleRouteJson): PhysicalBoard {
  const cached = boardCache.get(physicalSrj)
  if (cached) return cached
  const { srj, connMap } = getPipeline9PhysicalGeometryContext(physicalSrj)
  const sourceNameByOwner = new Map<string, string>()
  for (const connection of srj.connections) {
    const owner = connMap.getNetConnectedToId(connection.name)
    if (owner !== undefined) sourceNameByOwner.set(owner, connection.name)
  }
  const dimensions = getViaDimensions(srj)
  let minimumPadDiameter = dimensions.padDiameter
  let minimumHoleDiameter = dimensions.holeDiameter
  let minimumTraceWidth = srj.minTraceWidth
  // Existing vias can be smaller than newly generated vias. A global lower
  // bound keeps the proof conservative when an existing transition is reused.
  for (const trace of srj.traces ?? []) {
    for (const point of trace.route) {
      if (point.route_type === "wire") {
        minimumTraceWidth = Math.min(minimumTraceWidth, point.width)
      }
      if (point.route_type !== "via") continue
      minimumPadDiameter = Math.min(
        minimumPadDiameter,
        point.via_diameter ?? dimensions.padDiameter,
      )
      minimumHoleDiameter = Math.min(
        minimumHoleDiameter,
        point.via_hole_diameter ?? dimensions.holeDiameter,
      )
    }
  }
  const padGap =
    srj.minViaEdgeToPadEdgeClearance ?? srj.minPadEdgeToPadEdgeClearance ?? 0.1
  const pads: PhysicalPad[] = []
  const conductors: ExistingConductor[] = []
  for (const obstacle of srj.obstacles) {
    const owners = new Set<string>()
    let unknownOwner = false
    for (const id of obstacle.connectedTo) {
      const owner = connMap.getNetConnectedToId(id)
      if (owner === undefined) unknownOwner = true
      else owners.add(owner)
    }
    if (
      unknownOwner ||
      obstacle.netIsAssignable ||
      obstacle.offBoardConnectsTo?.length
    )
      continue
    const { x, y } = obstacle.center
    if (![x, y, obstacle.width, obstacle.height].every(Number.isFinite))
      continue
    if (obstacle.__zLayers!.length > 1 && owners.size > 0) {
      const reach = Math.hypot(obstacle.width, obstacle.height) / 2
      conductors.push({
        minX: x - reach,
        maxX: x + reach,
        minY: y - reach,
        maxY: y + reach,
        owners,
      })
    }
    // Only axis-aligned rectangles supply coordinate bounds. Unsupported
    // shapes remain physical obstacles; they simply do not strengthen proof.
    if (
      obstacle.type !== "rect" ||
      obstacle.shape !== undefined ||
      obstacle.isNonPlatedHole ||
      obstacle.width < 0 ||
      obstacle.height < 0 ||
      (obstacle.ccwRotationDegrees ?? 0) % 180 !== 0
    )
      continue
    const radius =
      minimumPadDiameter / 2 +
      (isOpaqueUnownedObstacle(obstacle) ? 0 : padGap) -
      0.005
    if (!Number.isFinite(radius) || radius <= 0) continue
    pads.push({
      minX: x - obstacle.width / 2,
      maxX: x + obstacle.width / 2,
      minY: y - obstacle.height / 2,
      maxY: y + obstacle.height / 2,
      owners,
      radius,
    })
  }
  const index = pads.length > 0 ? new Flatbush(pads.length) : undefined
  for (const pad of pads) index!.add(pad.minX, pad.minY, pad.maxX, pad.maxY)
  index?.finish()
  const conductorIndex =
    conductors.length > 0 ? new Flatbush(conductors.length) : undefined
  for (const conductor of conductors) {
    conductorIndex!.add(
      conductor.minX,
      conductor.minY,
      conductor.maxX,
      conductor.maxY,
    )
  }
  conductorIndex?.finish()
  const board: PhysicalBoard = {
    pads,
    index,
    conductors,
    conductorIndex,
    connMap,
    maximumRadius: Math.max(0, ...pads.map((pad) => pad.radius)),
    minimumCenterSpacing:
      Math.max(
        minimumPadDiameter + (srj.minPadEdgeToPadEdgeClearance ?? 0.1),
        minimumHoleDiameter + (srj.minViaHoleEdgeToViaHoleEdgeClearance ?? 0.1),
      ) - 0.005,
    minimumTraceCenterSpacing:
      minimumTraceWidth + (srj.minTraceToPadEdgeClearance ?? 0.1) - 0.005,
    minimumTraceWidth,
    minimumViaPairSpacing:
      Math.max(
        minimumPadDiameter + (srj.minPadEdgeToPadEdgeClearance ?? 0.1),
        minimumHoleDiameter + (srj.minViaHoleEdgeToViaHoleEdgeClearance ?? 0.1),
      ) - 1e-6,
    minimumSameOwnerViaSpacing:
      minimumHoleDiameter +
      (srj.minViaHoleEdgeToViaHoleEdgeClearance ?? 0.1) -
      1e-6,
    minimumViaTraceRadius:
      minimumPadDiameter / 2 +
      minimumTraceWidth / 2 +
      (srj.minTraceToPadEdgeClearance ?? 0.1) -
      0.005,
    sharedEdgePlacement: new PhysicalSharedEdgePlacement(physicalSrj),
    sourceNameByOwner,
  }
  boardCache.set(physicalSrj, board)
  return board
}

/** Rejects only physically proved incompatible via or shared-face assignments. */
export function createPhysicalViaCapacityEvaluator({
  physicalSrj,
  freeRegionIds,
  sharedEdgeRegionIds,
  movableSharedEdgeRegionIds,
  planningObstacles,
  preserveSolitarySharedEdgePorts,
  throughViaCrosscutEnabled,
}: PhysicalViaCapacityContext): Evaluator | undefined {
  const throughViaCapacityEnabled =
    !physicalSrj.allowBlindAndBuriedVias && physicalSrj.layerCount >= 2
  const board = compilePhysicalBoard(physicalSrj)
  const crosscutScopeEnabled =
    throughViaCrosscutEnabled === true &&
    canUseThroughViaCrosscut({
      originalSrj: physicalSrj,
      planningSrj: physicalSrj,
      viaDiameter: getViaDimensions(physicalSrj).padDiameter,
      minTraceWidth: board.minimumTraceWidth,
    })
  const freeIds = new Set(freeRegionIds)
  const sharedIds = new Set(sharedEdgeRegionIds ?? freeRegionIds)
  const movableIds =
    movableSharedEdgeRegionIds === undefined
      ? undefined
      : new Set(movableSharedEdgeRegionIds)
  const planningIndex = planningObstacles?.length
    ? new Flatbush(planningObstacles.length)
    : undefined
  for (const obstacle of planningObstacles ?? []) {
    planningIndex!.add(
      obstacle.center.x - obstacle.width / 2,
      obstacle.center.y - obstacle.height / 2,
      obstacle.center.x + obstacle.width / 2,
      obstacle.center.y + obstacle.height / 2,
    )
  }
  planningIndex?.finish()
  const isMovableFace = (
    edge: SharedEdge,
    query: TinyHyperGraphRegionSegmentFeasibilityContext,
  ): boolean => {
    const face = edge.geometry
    if (!face || !movableIds || planningObstacles === undefined) return false
    edge.movable ??= face.ownerNodeIds.every((id) => movableIds.has(id))
    if (!edge.movable) return false
    if (preserveSolitarySharedEdgePorts === false) return true
    if (edge.blockedAnyLayer === undefined) {
      const epsilon = 1e-6
      const nearby =
        planningIndex?.search(
          Math.min(face.x1, face.x2) - epsilon,
          Math.min(face.y1, face.y2) - epsilon,
          Math.max(face.x1, face.x2) + epsilon,
          Math.max(face.y1, face.y2) + epsilon,
        ) ?? []
      edge.blockedAnyLayer = shouldIgnoreSharedEdge({
        sharedEdge: face,
        obstacles: nearby.map((id) => planningObstacles[id]!),
      })
    }
    if (!edge.blockedAnyLayer) return true
    const ports = new Set<string>()
    for (const portId of [query.fromPortId, query.toPortId]) {
      if (getSharedEdge(query.topology, portId)?.key !== edge.key) continue
      const metadata = query.topology.portMetadata?.[portId]
      ports.add(
        String(
          metadata?.serializedPortId ??
            metadata?.portId ??
            `tiny-port-${portId}`,
        ),
      )
    }
    for (const [routeId, first, second] of query.regionSegments) {
      if (query.ignoredRouteIds?.has(routeId)) continue
      for (const portId of [first, second]) {
        if (getSharedEdge(query.topology, portId)?.key !== edge.key) continue
        const metadata = query.topology.portMetadata?.[portId]
        ports.add(
          String(
            metadata?.serializedPortId ??
              metadata?.portId ??
              `tiny-port-${portId}`,
          ),
        )
      }
    }
    return ports.size > 1
  }
  const ownerByMetadata = new WeakMap<RouteMetadata, string | null>()
  const getOwner = (
    problem: Readonly<TinyHyperGraphProblem>,
    routeId: number,
  ): string | undefined => {
    const metadata = problem.routeMetadata?.[routeId] as
      | RouteMetadata
      | undefined
    if (!metadata || typeof metadata !== "object") return undefined
    const cached = ownerByMetadata.get(metadata)
    if (cached !== undefined) return cached === null ? undefined : cached
    const connection = metadata.simpleRouteConnection
    const ids = [
      metadata.connectionId,
      connection?.name,
      connection?.rootConnectionName,
      connection?.__netConnectionName,
      connection?.netConnectionName,
      ...(connection?.__rootConnectionNames ?? []),
    ]
    const owners = new Set(
      ids.flatMap((id) => {
        const owner =
          id === undefined ? undefined : board.connMap.getNetConnectedToId(id)
        return owner === undefined ? [] : [owner]
      }),
    )
    const owner = owners.size === 1 ? owners.values().next().value : undefined
    ownerByMetadata.set(metadata, owner ?? null)
    return owner
  }
  const edgesByTopology = new WeakMap<
    Readonly<TinyHyperGraphTopology>,
    {
      ports: Map<number, SharedEdge | null>
      faces: Map<string, SharedEdge | null>
    }
  >()
  const canUseSharedFace = (
    query: TinyHyperGraphRegionSegmentFeasibilityContext,
    portId: number,
    edge: SharedEdge,
  ): boolean => {
    const topology = query.topology
    const regions = topology.incidentPortRegion[portId]!
    if (
      movableIds
        ? isMovableFace(edge, query)
        : regions.every((id) =>
            freeIds.has(topology.regionMetadata?.[id]?.capacityMeshNodeId),
          )
    )
      return true
    // Special endpoint ports can be anchored outside a rectangle face. Only
    // redistributable free-space aliases can ignore their current offset XY.
    const face = edge.geometry
    if (!face) return false
    const x = topology.portX[portId]!
    const y = topology.portY[portId]!
    return (
      x >= Math.min(face.x1, face.x2) &&
      x <= Math.max(face.x1, face.x2) &&
      y >= Math.min(face.y1, face.y2) &&
      y <= Math.max(face.y1, face.y2)
    )
  }
  const getSharedEdge = (
    topology: Readonly<TinyHyperGraphTopology>,
    portId: number,
  ): SharedEdge | null => {
    let caches = edgesByTopology.get(topology)
    if (!caches) {
      caches = { ports: new Map(), faces: new Map() }
      edgesByTopology.set(topology, caches)
    }
    const cached = caches.ports.get(portId)
    if (cached !== undefined) return cached
    caches.ports.set(portId, null)
    const regions = topology.incidentPortRegion[portId]
    if (!regions || regions.length !== 2 || regions[0] === regions[1])
      return null
    const first = topology.regionMetadata?.[regions[0]!] as
      | CapacityMeshNode
      | undefined
    const second = topology.regionMetadata?.[regions[1]!] as
      | CapacityMeshNode
      | undefined
    const z = topology.portZ[portId]!
    const key = `${Math.min(...regions)}:${Math.max(...regions)}:${z}`
    const shared = caches.faces.get(key)
    if (shared !== undefined) {
      caches.ports.set(portId, shared)
      return shared
    }
    caches.faces.set(key, null)
    // Both identities come from the original producer whitelist. Serialized
    // metadata must not authorize a virtual or offboard shared face.
    if (
      !first?.center ||
      !second?.center ||
      !sharedIds.has(first.capacityMeshNodeId) ||
      !sharedIds.has(second.capacityMeshNodeId) ||
      !first.availableZ?.includes(z) ||
      !second.availableZ?.includes(z) ||
      !(first.width > 0) ||
      !(first.height > 0) ||
      !(second.width > 0) ||
      !(second.height > 0)
    )
      return null
    const a = {
      minX: first.center.x - first.width / 2,
      maxX: first.center.x + first.width / 2,
      minY: first.center.y - first.height / 2,
      maxY: first.center.y + first.height / 2,
    }
    const b = {
      minX: second.center.x - second.width / 2,
      maxX: second.center.x + second.width / 2,
      minY: second.center.y - second.height / 2,
      maxY: second.center.y + second.height / 2,
    }
    const coordinates = [...Object.values(a), ...Object.values(b)]
    if (!coordinates.every(Number.isFinite)) return null
    const error =
      1e-9 +
      Number.EPSILON *
        128 *
        coordinates.reduce((sum, coordinate) => sum + Math.abs(coordinate), 0)
    const overlapX = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX)
    const overlapY = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY)
    if (overlapX > error && overlapY > error) return null
    const vertical = Math.min(
      Math.abs(a.maxX - b.minX),
      Math.abs(b.maxX - a.minX),
    )
    const horizontal = Math.min(
      Math.abs(a.maxY - b.minY),
      Math.abs(b.maxY - a.minY),
    )
    let length: number
    let normalSeparation: number
    if (vertical <= error && overlapY > error && horizontal > error) {
      length = overlapY
      normalSeparation = vertical
    } else if (horizontal <= error && overlapX > error && vertical > error) {
      length = overlapX
      normalSeparation = horizontal
    } else return null
    // Redistribution can use the entire original face. Duplicate port XY
    // offsets are deliberately irrelevant: they need not lie on that face.
    // Only capacity-one is certified; larger capacities have alternative,
    // rather than mandatory, choices of routed owners to remove.
    const maximumSeparation = Math.hypot(
      length + 2 * error,
      normalSeparation + 2 * error,
    )
    const [firstId, secondId] = [
      first.capacityMeshNodeId,
      second.capacityMeshNodeId,
    ].sort()
    const edge: SharedEdge = {
      key,
      z,
      capacityOne: maximumSeparation < board.minimumTraceCenterSpacing,
      geometry: getSharedEdgeForNodePair({
        nodeAId: firstId!,
        nodeBId: secondId!,
        nodeBounds: new Map([
          [first.capacityMeshNodeId, a],
          [second.capacityMeshNodeId, b],
        ]),
      }),
      numericalSlack: 1e-8 + 4 * error + normalSeparation,
      domainsByOwner: new Map(),
    }
    caches.faces.set(key, edge)
    caches.ports.set(portId, edge)
    return edge
  }
  const getTraceDomain = (
    edge: SharedEdge,
    owner: string,
    z: number,
  ): TraceDomain | null | undefined => {
    if (!edge.geometry) return undefined
    // Existing fixed copper can be narrower than the new-route minimum.
    // Use that conservative floor for both domains and pair spacing.
    const width = board.minimumTraceWidth
    let widths = edge.domainsByOwner.get(owner)
    if (!widths) edge.domainsByOwner.set(owner, (widths = new Map()))
    const cached = widths.get(width)
    if (cached !== undefined) return cached
    const intervals = board.sharedEdgePlacement.getAllowedIntervals(
      edge.geometry,
      {
        z,
        owner,
        width,
      },
    )
    const domain =
      intervals.length === 0
        ? null
        : {
            min: Math.min(...intervals.map(([low]) => low)),
            max: Math.max(...intervals.map(([, high]) => high)),
            allowed: intervals,
          }
    widths.set(width, domain)
    return domain
  }
  const pointClearByTopology = new WeakMap<
    Readonly<TinyHyperGraphTopology>,
    Map<number, Map<string, boolean>>
  >()
  const pointValidator = createPipeline9StaticSegmentValidator(physicalSrj)
  const isPointClear = (
    topology: Readonly<TinyHyperGraphTopology>,
    portId: number,
    owner: string,
  ): boolean | undefined => {
    const sourceName = board.sourceNameByOwner.get(owner)
    if (!sourceName || board.minimumTraceWidth < physicalSrj.minTraceWidth)
      return undefined
    let ports = pointClearByTopology.get(topology)
    if (!ports) pointClearByTopology.set(topology, (ports = new Map()))
    let owners = ports.get(portId)
    if (!owners) ports.set(portId, (owners = new Map()))
    let clear = owners.get(owner)
    if (clear === undefined) {
      const point = {
        x: topology.portX[portId]!,
        y: topology.portY[portId]!,
        z: topology.portZ[portId]!,
      }
      clear = pointValidator({
        connectionName: sourceName,
        traceThickness: board.minimumTraceWidth,
        viaDiameter: getViaDimensions(physicalSrj).padDiameter,
        start: point,
        end: point,
      })
      owners.set(owner, clear)
    }
    return clear
  }
  const getPortDomain = (
    query: TinyHyperGraphRegionSegmentFeasibilityContext,
    portId: number,
    edge: SharedEdge,
    owner: string,
  ): TraceDomain | null | undefined => {
    const onFace = canUseSharedFace(query, portId, edge)
    const domain = getTraceDomain(edge, owner, query.topology.portZ[portId]!)
    const canBecomePreserved =
      domain === null &&
      preserveSolitarySharedEdgePorts !== false &&
      edge.blockedAnyLayer === true
    if (
      (!onFace || canBecomePreserved) &&
      isPointClear(query.topology, portId, owner) !== false
    )
      return undefined
    return domain
  }
  const getOrderedFeasibility = (
    edge: SharedEdge,
    query: TinyHyperGraphRegionSegmentFeasibilityContext,
    owner: string,
  ): TinyHyperGraphRegionSegmentFeasibilityResult => {
    if (!isMovableFace(edge, query) || !edge.geometry) return FEASIBLE
    const assignments: [number, number, string, boolean][] = []
    for (const [route, from, to] of query.regionSegments) {
      if (query.ignoredRouteIds?.has(route)) continue
      const fromMatches = getSharedEdge(query.topology, from)?.key === edge.key
      const toMatches = getSharedEdge(query.topology, to)?.key === edge.key
      if (!fromMatches && !toMatches) continue
      const otherOwner = getOwner(query.problem, route)
      if (otherOwner === undefined) return FEASIBLE
      if (fromMatches)
        assignments.push([route, from, otherOwner, route === query.routeId])
      if (toMatches)
        assignments.push([route, to, otherOwner, route === query.routeId])
    }
    assignments.push([query.routeId!, query.fromPortId, owner, true])
    assignments.push([query.routeId!, query.toPortId, owner, true])
    if (
      assignments.every(([, , eventOwner]) => eventOwner === owner) &&
      getTraceDomain(edge, owner, edge.z)
    )
      return FEASIBLE
    const events = new Map<number, OrderedSharedEdgeEvent>()
    const serializedIds = new Map<string, number>()
    for (const [route, portId, eventOwner, candidate] of assignments) {
      if (getSharedEdge(query.topology, portId)?.key !== edge.key) continue
      const existing = events.get(portId)
      if (existing) {
        if (existing.owner !== eventOwner) return FEASIBLE
        existing.candidate ||= candidate
        if (!candidate && !existing.routeIds.includes(route))
          existing.routeIds.push(route)
        continue
      }
      const domain = getTraceDomain(edge, eventOwner, edge.z)
      if (domain === undefined) return FEASIBLE
      const metadata = query.topology.portMetadata?.[portId]
      const serializedPortId = String(
        metadata?.serializedPortId ?? metadata?.portId ?? `tiny-port-${portId}`,
      )
      if (serializedIds.has(serializedPortId)) return FEASIBLE
      serializedIds.set(serializedPortId, portId)
      events.set(portId, {
        portId,
        serializedPortId,
        owner: eventOwner,
        connectionName: eventOwner,
        position:
          edge.geometry.orientation === "horizontal"
            ? query.topology.portX[portId]!
            : query.topology.portY[portId]!,
        width: board.minimumTraceWidth,
        allowed: domain === null ? [] : domain.allowed,
        routeIds: candidate ? [] : [route],
        candidate,
        preservedAlone:
          preserveSolitarySharedEdgePorts !== false &&
          edge.blockedAnyLayer === true &&
          isPointClear(query.topology, portId, eventOwner) !== false,
      })
    }
    const values = [...events.values()]
    if (
      values.every((event) => event.owner === owner && event.allowed.length > 0)
    )
      return FEASIBLE
    const family = values.sort((first, second) => first.portId - second.portId)
    const key = JSON.stringify(
      family.map((event) => [
        event.portId,
        event.owner,
        event.candidate,
        event.preservedAlone,
        event.routeIds.sort((first, second) => first - second),
      ]),
    )
    if (edge.lastOrdered?.key === key) return edge.lastOrdered.result
    const result = getOrderedSharedEdgeFeasibility({
      length: edge.geometry.length,
      events: family,
      minimumWidth: board.minimumTraceWidth,
      traceClearance: physicalSrj.minTraceToPadEdgeClearance ?? 0.1,
      proofSlack: edge.numericalSlack,
    })
    edge.lastOrdered = { key, result }
    return result
  }
  const boundsByTopology = new WeakMap<
    Readonly<TinyHyperGraphTopology>,
    Map<number, Map<string, Bounds | null>>
  >()
  const getBounds = (
    topology: Readonly<TinyHyperGraphTopology>,
    regionId: number,
    owner: string,
  ): Bounds | null => {
    let boundsByRegion = boundsByTopology.get(topology)
    if (!boundsByRegion)
      boundsByTopology.set(topology, (boundsByRegion = new Map()))
    let cache = boundsByRegion.get(regionId)
    if (!cache) boundsByRegion.set(regionId, (cache = new Map()))
    const cached = cache.get(owner)
    if (cached !== undefined) return cached
    const metadata = topology.regionMetadata?.[regionId] as
      | CapacityMeshNode
      | undefined
    if (!metadata?.center || !(metadata.width > 0) || !(metadata.height > 0))
      return null
    const original: Bounds = {
      minX: metadata.center.x - metadata.width / 2,
      maxX: metadata.center.x + metadata.width / 2,
      minY: metadata.center.y - metadata.height / 2,
      maxY: metadata.center.y + metadata.height / 2,
    }
    if (!Object.values(original).every(Number.isFinite)) return null
    // A connection may change layers through its existing plated copper,
    // without manufacturing a new via in this rectangle.
    const existing = board.conductorIndex?.search(
      original.minX,
      original.minY,
      original.maxX,
      original.maxY,
    )
    if (existing?.some((id) => board.conductors[id]!.owners.has(owner))) {
      cache.set(owner, null)
      return null
    }
    const bounds = { ...original }
    const slack =
      1e-9 +
      Number.EPSILON *
        128 *
        (Math.abs(original.minX) +
          Math.abs(original.maxX) +
          Math.abs(original.minY) +
          Math.abs(original.maxY))
    const reach = board.maximumRadius
    const nearby =
      board.index?.search(
        original.minX - reach,
        original.minY - reach,
        original.maxX + reach,
        original.maxY + reach,
      ) ?? []
    // Each contractor preserves every legal center. A second sweep combines
    // opposing pad constraints without approximating their nonrectangular union.
    for (let pass = 0; pass < (crosscutScopeEnabled ? 2 : 1); pass++) {
      for (const id of nearby) {
        const constraintBounds = crosscutScopeEnabled ? bounds : original
        const pad = board.pads[id]!
        if (pad.owners.has(owner)) continue
        const radius = pad.radius - slack
        const maxDx = Math.max(
          pad.minX - constraintBounds.minX,
          constraintBounds.maxX - pad.maxX,
          0,
        )
        if (maxDx < radius) {
          // The furthest possible x distance gives a necessary y distance even
          // beside a rounded offset corner. Clip only when one escape side is
          // outside the original cell; every legal center remains enclosed.
          const dy = Math.sqrt(radius * radius - maxDx * maxDx)
          if (constraintBounds.minY >= pad.minY)
            bounds.minY = Math.max(bounds.minY, pad.maxY + dy - slack)
          if (constraintBounds.maxY <= pad.maxY)
            bounds.maxY = Math.min(bounds.maxY, pad.minY - dy + slack)
        }
        const maxDy = Math.max(
          pad.minY - constraintBounds.minY,
          constraintBounds.maxY - pad.maxY,
          0,
        )
        if (maxDy < radius) {
          const dx = Math.sqrt(radius * radius - maxDy * maxDy)
          if (constraintBounds.minX >= pad.minX)
            bounds.minX = Math.max(bounds.minX, pad.maxX + dx - slack)
          if (constraintBounds.maxX <= pad.maxX)
            bounds.maxX = Math.min(bounds.maxX, pad.minX - dx + slack)
        }
      }
    }
    cache.set(owner, bounds)
    return bounds
  }
  const getCrosscutFeasibility = (
    query: TinyHyperGraphRegionSegmentFeasibilityContext,
  ): TinyHyperGraphRegionSegmentFeasibilityResult => {
    if (!crosscutScopeEnabled || query.regionSegments.length < 1)
      return FEASIBLE
    const node = query.topology.regionMetadata?.[query.regionId] as
      | CapacityMeshNode
      | undefined
    if (!node?.center || !freeIds.has(node.capacityMeshNodeId)) return FEASIBLE
    const bounds: Bounds = {
      minX: node.center.x - node.width / 2,
      maxX: node.center.x + node.width / 2,
      minY: node.center.y - node.height / 2,
      maxY: node.center.y + node.height / 2,
    }
    const vias = new Map<string, ThroughViaDemand>()
    const segments = query.regionSegments.filter(
      ([route]) => !query.ignoredRouteIds?.has(route),
    )
    const assignments = [
      ...segments,
      [query.routeId!, query.fromPortId, query.toPortId] as const,
    ]
    for (const [route, from, to] of assignments) {
      if (query.topology.portZ[from] === query.topology.portZ[to]) continue
      const owner = getOwner(query.problem, route)
      if (owner === undefined) continue
      const domain = getBounds(query.topology, query.regionId, owner)
      // Existing plated copper can satisfy a transition outside this demand model.
      if (!domain) continue
      let demand = vias.get(owner)
      if (!demand) {
        demand = { owner, bounds: domain, routeIds: [], candidate: false }
        vias.set(owner, demand)
      }
      demand.candidate ||= route === query.routeId
      if (route !== query.routeId && !demand.routeIds.includes(route))
        demand.routeIds.push(route)
    }
    const owners = new Set(
      assignments.flatMap(([route]) => {
        const owner = getOwner(query.problem, route)
        return owner === undefined ? [] : [owner]
      }),
    )
    if (owners.size < 2) return FEASIBLE
    // Native families use the node-plus-port hull. Certify that projected
    // movable faces and every fixed endpoint keep that hull inside this box.
    for (const [, from, to] of assignments) {
      for (const port of [from, to]) {
        const face = getSharedEdge(query.topology, port)
        if (face?.geometry && isMovableFace(face, query)) {
          const edge = face.geometry
          if (
            Math.min(edge.x1, edge.x2) < bounds.minX ||
            Math.max(edge.x1, edge.x2) > bounds.maxX ||
            Math.min(edge.y1, edge.y2) < bounds.minY ||
            Math.max(edge.y1, edge.y2) > bounds.maxY
          )
            return FEASIBLE
          continue
        }
        const x = query.topology.portX[port]!,
          y = query.topology.portY[port]!
        if (
          x < bounds.minX ||
          x > bounds.maxX ||
          y < bounds.minY ||
          y > bounds.maxY
        )
          return FEASIBLE
      }
    }
    const approaches = new Map<string, ViaApproachDemand>()
    const planarWires = new Map<string, PlanarCrosscutDemand>()
    const contactForPort = (
      port: number,
      owner: string,
    ): CrosscutBoundaryContact | undefined => {
      const face = getSharedEdge(query.topology, port)
      if (!face?.geometry || !canUseSharedFace(query, port, face))
        return undefined
      const domain = getTraceDomain(face, owner, query.topology.portZ[port]!)
      if (!domain) return undefined
      const side = face.geometry.nodeSideByOwnerId[node.capacityMeshNodeId]
      const vertical = side === "left" || side === "right"
      return {
        side,
        normal: vertical ? face.geometry.x1 : face.geometry.y1,
        min: (vertical ? face.geometry.y1 : face.geometry.x1) + domain.min,
        max: (vertical ? face.geometry.y1 : face.geometry.x1) + domain.max,
      }
    }
    for (const [route, from, to] of assignments) {
      if (query.topology.portZ[from] === query.topology.portZ[to]) continue
      const owner = getOwner(query.problem, route)
      if (owner === undefined) continue
      const domain = vias.get(owner)?.bounds
      if (!domain) continue
      for (const port of [from, to]) {
        const contact = contactForPort(port, owner)
        if (!contact) continue
        const key = JSON.stringify([owner, port])
        let approach = approaches.get(key)
        if (!approach) {
          approach = {
            owner,
            bounds: domain,
            layer: query.topology.portZ[port]!,
            contact,
            routeIds: [],
            candidate: false,
          }
          approaches.set(key, approach)
        }
        approach.candidate ||= route === query.routeId
        if (route !== query.routeId && !approach.routeIds.includes(route))
          approach.routeIds.push(route)
      }
    }
    const wires = new Map<string, ThroughWireDemand>()
    for (const [route, from, to] of assignments) {
      const owner = getOwner(query.problem, route)
      if (owner === undefined) continue
      const wireViaBounds = getBounds(query.topology, query.regionId, owner)
      if (!wireViaBounds) continue
      const firstFace = getSharedEdge(query.topology, from)
      const secondFace = getSharedEdge(query.topology, to)
      if (
        !firstFace?.geometry ||
        !secondFace?.geometry ||
        !canUseSharedFace(query, from, firstFace) ||
        !canUseSharedFace(query, to, secondFace)
      )
        continue
      const firstSide =
        firstFace.geometry.nodeSideByOwnerId[node.capacityMeshNodeId]
      const secondSide =
        secondFace.geometry.nodeSideByOwnerId[node.capacityMeshNodeId]
      const axis =
        (firstSide === "left" && secondSide === "right") ||
        (firstSide === "right" && secondSide === "left")
          ? "x"
          : (firstSide === "top" && secondSide === "bottom") ||
              (firstSide === "bottom" && secondSide === "top")
            ? "y"
            : undefined
      const key = JSON.stringify([
        owner,
        Math.min(from, to),
        Math.max(from, to),
      ])
      if (query.topology.portZ[from] === query.topology.portZ[to]) {
        const first = contactForPort(from, owner),
          second = contactForPort(to, owner)
        if (!first || !second) continue
        let planar = planarWires.get(key)
        if (!planar) {
          planar = { owner, layer: query.topology.portZ[from]!, viaBounds: wireViaBounds,
            first, second, routeIds: [], candidate: false }
          planarWires.set(key, planar)
        }
        planar.candidate ||= route === query.routeId
        if (route !== query.routeId && !planar.routeIds.includes(route)) planar.routeIds.push(route)
      }
      if (axis) {
        let wire = wires.get(key)
        if (!wire) {
          wire = { owner, axis, routeIds: [], candidate: false }
          wires.set(key, wire)
        }
        wire.candidate ||= route === query.routeId
        if (route !== query.routeId && !wire.routeIds.includes(route))
          wire.routeIds.push(route)
      }
    }
    const slack =
      1e-9 +
      Number.EPSILON *
        128 *
        Object.values(bounds).reduce(
          (sum, coordinate) => sum + Math.abs(coordinate),
          0,
        )
    const planar = getNoViaPlanarCrossingFeasibility({
      bounds, wires: [...planarWires.values()],
      minimumTraceSpacing: board.minimumTraceCenterSpacing, slack,
    })
    if (!planar.feasible) return planar
    const pair = getThroughViaCrosscutFeasibility({
      bounds,
      vias: [...vias.values()],
      wires: [...wires.values()],
      radius: board.minimumViaTraceRadius - slack,
      minimumViaSpacing: board.minimumViaPairSpacing - slack,
      slack,
    })
    if (!pair.feasible) return pair
    if (owners.size >= 3 && vias.size > 0) {
      const unequal = getUnequalViaDomainCrosscutFeasibility({
        bounds, vias: [...vias.values()], wires: [...planarWires.values()],
        radius: board.minimumViaTraceRadius - 4 * slack,
        minimumForeignViaSpacing: board.minimumViaPairSpacing - slack,
        minimumSameOwnerViaSpacing: board.minimumSameOwnerViaSpacing - slack,
        minimumTraceSpacing: board.minimumTraceCenterSpacing,
        slack,
      })
      if (!unequal.feasible) return unequal
    }
    return getViaApproachCrosscutFeasibility({
      bounds, approaches: [...approaches.values()], wires: [...planarWires.values()],
      radius: board.minimumViaTraceRadius - 4 * slack,
      minimumForeignViaSpacing: board.minimumViaPairSpacing - slack,
      minimumSameOwnerViaSpacing: board.minimumSameOwnerViaSpacing - slack,
      minimumTraceSpacing: board.minimumTraceCenterSpacing,
      slack,
    })
  }
  return (query): TinyHyperGraphRegionSegmentFeasibilityResult => {
    const {
      topology,
      problem,
      regionId,
      fromPortId,
      toPortId,
      routeId,
      regionSegments,
      ignoredRouteIds,
    } = query
    const regionNodeId = topology.regionMetadata?.[regionId]?.capacityMeshNodeId
    if (!sharedIds.has(regionNodeId) && !freeIds.has(regionNodeId))
      return FEASIBLE
    const fromEdge = getSharedEdge(topology, fromPortId)
    const toEdge = getSharedEdge(topology, toPortId)
    const sameLayer = topology.portZ[fromPortId] === topology.portZ[toPortId]
    if (sameLayer && !fromEdge && !toEdge) return FEASIBLE
    const owner = routeId === undefined ? undefined : getOwner(problem, routeId)
    if (owner === undefined) return FEASIBLE
    for (const edge of new Set([fromEdge, toEdge])) {
      if (
        !edge ||
        preserveSolitarySharedEdgePorts === false ||
        !isMovableFace(edge, query) ||
        !edge.blockedAnyLayer
      )
        continue
      const conditional = getOrderedFeasibility(edge, query, owner)
      if (!conditional.feasible) return conditional
    }
    for (const [edge, portId] of [
      [fromEdge, fromPortId],
      [toEdge, toPortId],
    ] as const) {
      if (!edge) continue
      if (getPortDomain(query, portId, edge, owner) === null)
        return { feasible: false, blockerRouteIds: [] }
    }
    if (fromEdge || toEdge) {
      const blockers = new Set<number>()
      for (const [otherRoute, first, second] of regionSegments) {
        if (ignoredRouteIds?.has(otherRoute)) continue
        const otherOwner = getOwner(problem, otherRoute)
        if (otherOwner === undefined || otherOwner === owner) continue
        for (const otherPort of [first, second]) {
          const edge = getSharedEdge(topology, otherPort)
          if (!edge || (edge.key !== fromEdge?.key && edge.key !== toEdge?.key))
            continue
          const candidatePort =
            edge.key === fromEdge?.key ? fromPortId : toPortId
          if (
            edge.capacityOne &&
            canUseSharedFace(query, candidatePort, edge) &&
            canUseSharedFace(query, otherPort, edge)
          ) {
            blockers.add(otherRoute)
            continue
          }
          const domain = getPortDomain(query, candidatePort, edge, owner)
          const other = getPortDomain(query, otherPort, edge, otherOwner)
          if (!domain || !other) continue
          if (edge.capacityOne) {
            blockers.add(otherRoute)
            continue
          }
          const maximumSeparation = Math.max(
            Math.abs(domain.min - other.max),
            Math.abs(domain.max - other.min),
          )
          if (
            maximumSeparation + edge.numericalSlack <
            board.minimumTraceCenterSpacing
          )
            blockers.add(otherRoute)
        }
      }
      if (blockers.size > 0)
        return { feasible: false, blockerRouteIds: [...blockers] }
    }
    for (const edge of new Set([fromEdge, toEdge])) {
      if (!edge) continue
      const ordered = getOrderedFeasibility(edge, query, owner)
      if (!ordered.feasible) return ordered
    }
    const crosscut = getCrosscutFeasibility(query)
    if (!crosscut.feasible) return crosscut
    if (
      sameLayer ||
      !freeIds.has(regionNodeId) ||
      !throughViaCapacityEnabled ||
      !board.index ||
      !(board.minimumCenterSpacing > 0)
    )
      return FEASIBLE
    const bounds = getBounds(topology, regionId, owner)
    if (!bounds) return FEASIBLE
    if (bounds.minX > bounds.maxX || bounds.minY > bounds.maxY)
      return { feasible: false, blockerRouteIds: [] }
    const others = new Map<string, Set<number>>()
    for (const [otherRoute, first, second] of regionSegments) {
      if (
        ignoredRouteIds?.has(otherRoute) ||
        topology.portZ[first] === topology.portZ[second]
      )
        continue
      const otherOwner = getOwner(problem, otherRoute)
      if (otherOwner === undefined || otherOwner === owner) continue
      let ids = others.get(otherOwner)
      if (!ids) others.set(otherOwner, (ids = new Set()))
      ids.add(otherRoute)
    }
    const blockers = new Set<number>()
    for (const [otherOwner, ids] of others) {
      const other = getBounds(topology, regionId, otherOwner)
      if (!other) continue
      const maxDx = Math.max(
        Math.abs(bounds.minX - other.maxX),
        Math.abs(bounds.maxX - other.minX),
      )
      const maxDy = Math.max(
        Math.abs(bounds.minY - other.maxY),
        Math.abs(bounds.maxY - other.minY),
      )
      if (
        other.minX > other.maxX ||
        other.minY > other.maxY ||
        Math.hypot(maxDx, maxDy) + 1e-8 < board.minimumCenterSpacing
      )
        for (const id of ids) blockers.add(id)
    }
    return blockers.size === 0
      ? FEASIBLE
      : { feasible: false, blockerRouteIds: [...blockers] }
  }
}
