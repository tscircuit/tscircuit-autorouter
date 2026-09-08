import type {
  ConnectionPoint,
  Obstacle,
  SimpleRouteConnection,
  SimpleRouteJson,
} from "lib/types/srj-types"
import { getObstacleZLayersOnBoard } from "lib/utils/create-srj-with-board-valid-obstacle-layers"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { mapLayerNameToZ } from "lib/utils/mapLayerNameToZ"
import {
  createPipeline9FixedPadClearance,
  type Pipeline9FixedPadClearance,
} from "./createPipeline9FixedPadClearance"

type Point = Readonly<{ x: number; y: number }>
type TerminalOccurrence = {
  readonly connection: SimpleRouteConnection
  readonly point: ConnectionPoint
}
type PadLocalGeometry = {
  readonly x: number
  readonly y: number
  readonly halfWidth: number
  readonly halfHeight: number
}
type CoordinateReference =
  | {
      readonly kind: "point"
      readonly connectionName: string
      readonly pcbPortId: string | undefined
    }
  | {
      readonly kind: "obstacle"
      readonly connectedIds: readonly string[]
    }
type RoutingCoordinateIdentity = {
  readonly referencesByKey: ReadonlyMap<string, readonly CoordinateReference[]>
  readonly declaredElectricalIds: ReadonlySet<string>
}

const getRoutingCoordinateKey = (
  point: Point,
  zLayers: readonly number[],
): string => {
  // Match getConnectivityMapFromSimpleRouteJson exactly, including Math.round
  // stringification of signed zero and the existing default layer sort.
  const x = Math.round(point.x * 100)
  const y = Math.round(point.y * 100)
  const layers = [...zLayers].sort().join("-")
  return `${x},${y}:${layers}`
}

const collectRoutingCoordinateIdentity = (
  srj: SimpleRouteJson,
): RoutingCoordinateIdentity => {
  const referencesByKey = new Map<string, CoordinateReference[]>()
  const declaredElectricalIds = new Set<string>()
  for (const connection of srj.connections) {
    declaredElectricalIds.add(connection.name)
    for (const id of connection.__rootConnectionNames ?? []) {
      declaredElectricalIds.add(id)
    }
    if (connection.__netConnectionName) {
      declaredElectricalIds.add(connection.__netConnectionName)
    }
    for (const point of connection.pointsToConnect) {
      if (point.pcb_port_id) declaredElectricalIds.add(point.pcb_port_id)
      if (point.pointId) declaredElectricalIds.add(point.pointId)
      const zLayers =
        "layers" in point
          ? point.layers.map((layer): number =>
              mapLayerNameToZ(layer, srj.layerCount),
            )
          : [mapLayerNameToZ(point.layer, srj.layerCount)]
      const key = getRoutingCoordinateKey(point, zLayers)
      const reference: CoordinateReference = {
        kind: "point",
        connectionName: connection.name,
        pcbPortId: point.pcb_port_id,
      }
      const references = referencesByKey.get(key)
      if (references) references.push(reference)
      else referencesByKey.set(key, [reference])
    }
  }
  for (const obstacle of srj.obstacles) {
    const connectedIds = [
      ...obstacle.connectedTo,
      ...(obstacle.offBoardConnectsTo ?? []),
    ]
    if (obstacle.obstacleId) declaredElectricalIds.add(obstacle.obstacleId)
    for (const id of connectedIds) {
      if (id) declaredElectricalIds.add(id)
    }
    const key = getRoutingCoordinateKey(
      obstacle.center,
      obstacle.layers.map((layer): number =>
        mapLayerNameToZ(layer, srj.layerCount),
      ),
    )
    const reference: CoordinateReference = { kind: "obstacle", connectedIds }
    const references = referencesByKey.get(key)
    if (references) references.push(reference)
    else referencesByKey.set(key, [reference])
  }
  for (const trace of srj.traces ?? []) {
    for (const id of [
      trace.pcb_trace_id,
      trace.connection_name,
      ...(trace.connectsTo ?? []),
    ]) {
      if (id) declaredElectricalIds.add(id)
    }
  }
  return { referencesByKey, declaredElectricalIds }
}

const getPadLocalGeometry = (
  point: Point,
  obstacle: Obstacle,
): PadLocalGeometry | undefined => {
  const rotation = obstacle.ccwRotationDegrees ?? 0
  if (
    ![
      point.x,
      point.y,
      obstacle.center.x,
      obstacle.center.y,
      obstacle.width,
      obstacle.height,
      rotation,
    ].every(Number.isFinite) ||
    obstacle.width <= 0 ||
    obstacle.height <= 0
  ) {
    return undefined
  }
  const angle = ((rotation % 360) * Math.PI) / 180
  const dx = point.x - obstacle.center.x
  const dy = point.y - obstacle.center.y
  return {
    x: dx * Math.cos(angle) + dy * Math.sin(angle),
    y: -dx * Math.sin(angle) + dy * Math.cos(angle),
    halfWidth: obstacle.width / 2,
    halfHeight: obstacle.height / 2,
  }
}

const isInsidePadEnvelope = (point: Point, obstacle: Obstacle): boolean => {
  const local = getPadLocalGeometry(point, obstacle)
  return (
    local !== undefined &&
    Math.abs(local.x) <= local.halfWidth &&
    Math.abs(local.y) <= local.halfHeight
  )
}

const isInsideSupportedPad = (
  point: Point,
  obstacle: Obstacle,
  radius: number,
): boolean => {
  const local = getPadLocalGeometry(point, obstacle)
  if (local === undefined) return false
  const type = (obstacle as { type?: string }).type
  if (type === "rect") {
    return (
      Math.abs(local.x) + radius <= local.halfWidth &&
      Math.abs(local.y) + radius <= local.halfHeight
    )
  }
  return (
    type === "oval" &&
    local.halfWidth === local.halfHeight &&
    Math.hypot(local.x, local.y) + radius <= local.halfWidth
  )
}

const collectTerminalOccurrences = (
  srj: SimpleRouteJson,
): Map<string, TerminalOccurrence[]> => {
  const occurrences = new Map<string, TerminalOccurrence[]>()
  for (const connection of srj.connections) {
    for (const point of connection.pointsToConnect) {
      if (!point.pcb_port_id) continue
      const entries = occurrences.get(point.pcb_port_id)
      if (entries) entries.push({ connection, point })
      else occurrences.set(point.pcb_port_id, [{ connection, point }])
    }
  }
  return occurrences
}

const getRequiredLandingWidth = (params: {
  originalSrj: SimpleRouteJson
  routingSrj: SimpleRouteJson
}): number => {
  const width = params.routingSrj.minTraceWidth
  if (!Number.isFinite(width) || width <= 0 || width / 2 <= 0) {
    throw new Error(
      "Pipeline9 pad-area terminals require a finite positive width",
    )
  }
  if (width !== params.originalSrj.minTraceWidth) {
    throw new Error(
      "Pipeline9 pad-area inputs must use the same minimum trace width",
    )
  }
  // This is the actual generated HD width. Nominal/bus widths remain preferred
  // targets of the unchanged later TraceWidthSolver, which can keep min width.
  // Treating those targets as hard minima here would reject legal attachments.
  return width
}

/** The existing terminal-escape interior family, without conflict ranking. */
const getPadInteriorLandingCandidates = (
  ownPad: Obstacle,
  radius: number,
): Point[] => {
  const halfWidth = ownPad.width / 2 - radius
  const halfHeight = ownPad.height / 2 - radius
  if (halfWidth < 0 || halfHeight < 0) return []
  const rotation = (((ownPad.ccwRotationDegrees ?? 0) % 360) * Math.PI) / 180
  const candidates: Point[] = []
  for (const radialFactor of [0.9, 0.72]) {
    for (let angleIndex = 0; angleIndex < 16; angleIndex++) {
      const angle = (angleIndex * Math.PI) / 8
      const x = Math.cos(angle) * halfWidth * radialFactor
      const y = Math.sin(angle) * halfHeight * radialFactor
      candidates.push({
        x: ownPad.center.x + x * Math.cos(rotation) - y * Math.sin(rotation),
        y: ownPad.center.y + x * Math.sin(rotation) + y * Math.cos(rotation),
      })
    }
  }
  return candidates
}

/**
 * Choose routing-only landings before topology/MST/native routing. Final output
 * already supports attaching to the declared pad area without a wire back to
 * its logical center. This does not move fixed copper or change terminal layers.
 * The finite interior family is not an exhaustive pad-area feasibility proof.
 */
export const resolvePipeline9PadAreaTerminals = (params: {
  originalSrj: SimpleRouteJson
  routingSrj: SimpleRouteJson
}): SimpleRouteJson => {
  const { originalSrj, routingSrj } = params
  // Polygon-edge clearance is not represented by the rectangular-board contract.
  if (originalSrj.outline !== undefined) return routingSrj
  if (originalSrj.layerCount !== routingSrj.layerCount) {
    throw new Error("Pipeline9 pad-area inputs must use the same layer count")
  }
  const width = getRequiredLandingWidth(params)
  const originalOccurrencesById = collectTerminalOccurrences(originalSrj)
  const routingOccurrencesById = collectTerminalOccurrences(routingSrj)
  const excludedTerminalIds = new Set<string>()
  for (const trace of originalSrj.traces ?? []) {
    for (const id of trace.connectsTo ?? []) excludedTerminalIds.add(id)
    if (trace.connectsTo && trace.connectsTo.length > 0) {
      // The existing initial-connectivity map includes the trace ID alongside
      // its declared endpoint IDs; connection points address that map by pointId.
      excludedTerminalIds.add(trace.pcb_trace_id)
    }
    for (const entry of trace.route) {
      if (entry.route_type !== "wire") continue
      if (entry.start_pcb_port_id) {
        excludedTerminalIds.add(entry.start_pcb_port_id)
      }
      if (entry.end_pcb_port_id) excludedTerminalIds.add(entry.end_pcb_port_id)
    }
  }
  for (const srj of [originalSrj, routingSrj]) {
    for (const connection of srj.connections) {
      // These declarations feed the existing MST's zero-weight/omitted edges.
      // Classify them before landing selection, without choosing an MST route.
      for (const group of connection.externallyConnectedPointIds ?? []) {
        for (const id of group) excludedTerminalIds.add(id)
      }
      if (connection.isOffBoard !== true) continue
      for (const point of connection.pointsToConnect) {
        // Native off-board equivalence is keyed by pointId, including optional
        // alternatives whose own occurrence does not carry a PCB identifier.
        if (point.pointId) excludedTerminalIds.add(point.pointId)
        if (point.pcb_port_id) excludedTerminalIds.add(point.pcb_port_id)
      }
    }
  }
  const connMap = getConnectivityMapFromSimpleRouteJson(originalSrj)
  const routingConnMap = getConnectivityMapFromSimpleRouteJson(routingSrj)
  const coordinateIdentity = collectRoutingCoordinateIdentity(routingSrj)
  const landings = new Map<string, Point>()
  const landingNetByCoordinateKey = new Map<string, string>()
  let clearance: Pipeline9FixedPadClearance | undefined
  for (const [pcbPortId, routingOccurrences] of routingOccurrencesById) {
    if (excludedTerminalIds.has(pcbPortId)) continue
    const originalOccurrences = originalOccurrencesById.get(pcbPortId)
    if (!originalOccurrences || originalOccurrences.length === 0) continue
    const occurrences = [...originalOccurrences, ...routingOccurrences]
    if (
      !routingOccurrences.some(
        ({ connection }): boolean =>
          connection.isOffBoard !== true &&
          connection.pointsToConnect.length >= 2,
      ) ||
      occurrences.some(
        ({ connection, point }): boolean =>
          connection.isOffBoard === true ||
          (point.pointId !== undefined &&
            excludedTerminalIds.has(point.pointId)),
      )
    ) {
      continue
    }
    const sourcePoint = originalOccurrences[0]!.point
    if (!("layer" in sourcePoint) || sourcePoint.terminalVia) continue
    const canonicalNetId = connMap.getNetConnectedToId(pcbPortId)
    if (typeof canonicalNetId !== "string" || canonicalNetId.length === 0) {
      continue
    }
    const z = mapLayerNameToZ(sourcePoint.layer, originalSrj.layerCount)
    if (!Number.isInteger(z) || z < 0 || z >= originalSrj.layerCount) continue
    if (
      occurrences.some(
        ({ connection, point }): boolean =>
          !("layer" in point) ||
          !!point.terminalVia ||
          point.x !== sourcePoint.x ||
          point.y !== sourcePoint.y ||
          mapLayerNameToZ(point.layer, originalSrj.layerCount) !== z ||
          connMap.getNetConnectedToId(connection.name) !== canonicalNetId,
      )
    ) {
      continue
    }

    const routingNetId = routingConnMap.getNetConnectedToId(pcbPortId)
    if (typeof routingNetId !== "string" || routingNetId.length === 0) {
      throw new Error(
        `Pipeline9 pad-area terminal "${pcbPortId}" has no routing net identity`,
      )
    }
    const oldCoordinateKey = getRoutingCoordinateKey(sourcePoint, [z])
    if (coordinateIdentity.declaredElectricalIds.has(oldCoordinateKey)) continue
    const oldReferences =
      coordinateIdentity.referencesByKey.get(oldCoordinateKey)
    if (oldReferences === undefined) {
      throw new Error(
        `Pipeline9 pad-area terminal "${pcbPortId}" has no routing coordinate reference`,
      )
    }
    const declaringConnectionNames = new Set(
      routingOccurrences.map(({ connection }): string => connection.name),
    )
    // Removing this point's old spatial key must not split a declared net.
    // Every remaining reference must already link this PCB without using XY.
    // Literal electrical IDs equal to the key were excluded above as well.
    if (
      oldReferences.some((reference): boolean =>
        reference.kind === "point"
          ? reference.pcbPortId !== pcbPortId &&
            !declaringConnectionNames.has(reference.connectionName)
          : !reference.connectedIds.includes(pcbPortId),
      )
    ) {
      continue
    }

    // Net-wide PCB membership alone is not pad identity. Every shape contributes
    // its source envelope to ambiguity detection, but only supported real own
    // geometry may authorize a landing. No nearest/first-obstacle selection.
    const ownerEnvelopes = originalSrj.obstacles.filter(
      (obstacle): boolean =>
        obstacle.isCopperPour !== true &&
        obstacle.connectedTo.includes(pcbPortId) &&
        isInsidePadEnvelope(sourcePoint, obstacle) &&
        getObstacleZLayersOnBoard(obstacle, originalSrj.layerCount).includes(z),
    )
    if (ownerEnvelopes.length !== 1) continue
    const ownPad = ownerEnvelopes[0]!
    if (
      ownPad.netIsAssignable === true ||
      ownPad.offBoardConnectsTo !== undefined ||
      !isInsideSupportedPad(sourcePoint, ownPad, 0)
    ) {
      continue
    }
    const radius = width / 2
    const boardGap = originalSrj.minBoardEdgeClearance ?? 0
    const bounds = originalSrj.bounds
    if (
      !Number.isFinite(radius) ||
      radius <= 0 ||
      !Number.isFinite(boardGap) ||
      boardGap < 0 ||
      ![bounds.minX, bounds.maxX, bounds.minY, bounds.maxY].every(
        Number.isFinite,
      ) ||
      bounds.minX >= bounds.maxX ||
      bounds.minY >= bounds.maxY
    ) {
      throw new Error(
        "Pipeline9 pad-area terminals require finite physical bounds",
      )
    }
    if (!clearance) {
      clearance = createPipeline9FixedPadClearance({
        obstacles: originalSrj.obstacles,
        connMap,
        layerCount: originalSrj.layerCount,
        traceToPadClearance: originalSrj.minTraceToPadEdgeClearance ?? 0.1,
        viaToPadClearance: originalSrj.minViaEdgeToPadEdgeClearance ?? 0.1,
      })
    }
    const isLegalLanding = (point: Point): boolean => {
      const key = getRoutingCoordinateKey(point, [z])
      const existingNet = routingConnMap.getNetConnectedToId(key)
      const selectedNet = landingNetByCoordinateKey.get(key)
      return (
        (existingNet === undefined || existingNet === routingNetId) &&
        (selectedNet === undefined || selectedNet === routingNetId) &&
        point.x - radius - boardGap >= bounds.minX &&
        point.x + radius + boardGap <= bounds.maxX &&
        point.y - radius - boardGap >= bounds.minY &&
        point.y + radius + boardGap <= bounds.maxY &&
        clearance!.traceClearanceIndex.isPointClear({
          point: { ...point, z },
          canonicalNetId,
          copperDiameter: width,
        })
      )
    }
    // A source-declared legal attachment need not contain the whole wire disk
    // inside its own pad (a wide wire may attach to a narrower pad). Do not add
    // that new restriction to unchanged terminals. Relocated points do have the
    // stronger containment certificate, including original rotation/circle.
    if (isLegalLanding(sourcePoint)) continue
    const candidates = getPadInteriorLandingCandidates(ownPad, radius)
      .filter(
        (point): boolean =>
          isInsideSupportedPad(point, ownPad, radius) && isLegalLanding(point),
      )
      .sort(
        (left, right): number =>
          Math.hypot(left.x - sourcePoint.x, left.y - sourcePoint.y) -
            Math.hypot(right.x - sourcePoint.x, right.y - sourcePoint.y) ||
          left.x - right.x ||
          left.y - right.y,
      )
    const landing = candidates[0]
    if (landing === undefined) {
      throw new Error(
        `Pipeline9 PCB terminal "${pcbPortId}" on layer "${sourcePoint.layer}" has no legal candidate in the supported landing set`,
      )
    }
    landings.set(pcbPortId, landing)
    // The unchanged map guards existing keys; this table guards collisions
    // between newly selected keys before any derived connection is published.
    landingNetByCoordinateKey.set(
      getRoutingCoordinateKey(landing, [z]),
      routingNetId,
    )
  }
  if (landings.size === 0) return routingSrj
  return {
    ...routingSrj,
    connections: routingSrj.connections.map(
      (connection): SimpleRouteConnection => {
        if (
          !connection.pointsToConnect.some(
            (point): boolean =>
              point.pcb_port_id !== undefined &&
              landings.has(point.pcb_port_id),
          )
        ) {
          return connection
        }
        return {
          ...connection,
          pointsToConnect: connection.pointsToConnect.map(
            (point): ConnectionPoint => {
              const landing = point.pcb_port_id
                ? landings.get(point.pcb_port_id)
                : undefined
              return landing ? { ...point, x: landing.x, y: landing.y } : point
            },
          ),
        }
      },
    ),
  }
}
