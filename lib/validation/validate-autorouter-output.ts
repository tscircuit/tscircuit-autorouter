import { doSegmentsIntersect } from "@tscircuit/math-utils"
import type {
  ConnectionPoint,
  Obstacle,
  SimpleRouteConnection,
  SimpleRouteJson,
} from "../types/srj-types"
import { mapLayerNameToZ } from "../utils/mapLayerNameToZ"
import { mapZToLayerName } from "../utils/mapZToLayerName"

export type AutorouterOutputDiagnosticCode =
  | "UNKNOWN_CONNECTION"
  | "INVALID_SEGMENT"
  | "UNKNOWN_LAYER"
  | "NON_FINITE_COORDINATE"
  | "DIFFERENT_CONNECTION_SAME_LAYER_CROSSING"
  | "DISCONNECTED_ROUTE_ENDPOINT"

export interface AutorouterOutputDiagnostic {
  readonly code: AutorouterOutputDiagnosticCode
  readonly connectionName: string
  readonly traceId?: string
  readonly peerConnectionName?: string
  readonly peerTraceId?: string
  readonly layer?: string
  readonly segmentIndex?: number
  readonly peerSegmentIndex?: number
  readonly coordinate?: Readonly<{ x: number; y: number }>
}

export interface AutorouterOutputValidationResult {
  readonly valid: boolean
  readonly diagnostics: readonly Readonly<AutorouterOutputDiagnostic>[]
}

export interface ValidateAutorouterOutputInput {
  inputSrj: SimpleRouteJson
  outputSrj: SimpleRouteJson
}

export class AutorouterOutputValidationError extends Error {
  constructor(public readonly result: AutorouterOutputValidationResult) {
    super(
      `Autorouter output failed topology validation: ${result.diagnostics
        .map((diagnostic) => diagnostic.code)
        .join(", ")}`,
    )
    this.name = "AutorouterOutputValidationError"
  }
}

type Point = Readonly<{ x: number; y: number }>
type Anchor = Readonly<{
  point: Point
  layers: readonly string[]
  owner: string
}>
type WireSegment = Readonly<{
  start: Point
  end: Point
  layer: string
  routeIndex: number
}>
type ViaPoint = Readonly<{
  point: Point
  layers: readonly string[]
  routeIndex: number
}>
type ConnectedObstacle = Readonly<{ owner: string; obstacle: Obstacle }>
type PreparedTrace = Readonly<{
  traceId: string
  connectionName: string
  owner: string | null
  references: readonly string[]
  segments: readonly WireSegment[]
  vias: readonly ViaPoint[]
  endpoints: readonly Readonly<{ point: Point; layers: readonly string[] }>[]
  shapeValid: boolean
}>

const UNKNOWN_CONNECTION_NAME = "<unknown>"
const POINT_EPSILON = 1e-9
const CONNECTED_OBSTACLE_TOLERANCE = 1e-3
const MAX_CONNECTIONS = 4096
const MAX_CONNECTION_POINTS = 16384
const MAX_OBSTACLES = 4096
const MAX_TRACES = 256
const MAX_ROUTE_ITEMS_PER_TRACE = 2048
const MAX_TOTAL_ROUTE_ITEMS = 4096
const MAX_DIAGNOSTICS = 256
const MAX_VALIDATION_WORK = 4_000_000
const MAX_RELATION_IDENTIFIERS_PER_ENTITY = 256
const MAX_LAYERS_PER_ENTITY = 32
const MAX_IDENTIFIER_LENGTH = 1024
const MAX_TOTAL_IDENTIFIER_CHARACTERS = 1_000_000

class ValidationBudgetExceeded extends Error {}

class IdentifierConnectivity {
  private readonly parent = new Map<string, string>()

  add(identifier: string): void {
    if (!this.parent.has(identifier)) {
      this.parent.set(identifier, identifier)
    }
  }

  find(identifier: string): string | null {
    const parent = this.parent.get(identifier)
    if (parent === undefined) return null
    if (parent === identifier) return identifier
    const root = this.find(parent)
    if (root === null) return null
    this.parent.set(identifier, root)
    return root
  }

  addGroup(identifiers: readonly string[]): void {
    const unique = [...new Set(identifiers.filter(Boolean))]
    if (unique.length === 0) return
    for (const identifier of unique) this.add(identifier)
    const root = this.find(unique[0]!)!
    for (const identifier of unique.slice(1)) {
      const otherRoot = this.find(identifier)!
      if (otherRoot !== root) this.parent.set(otherRoot, root)
    }
  }
}

const connectionIdentifiers = (
  connection: SimpleRouteConnection,
  layerCount: number,
): string[] => {
  const identifiers = [
    connection.name,
    connection.rootConnectionName,
    connection.netConnectionName,
    connection.__netConnectionName,
    ...(connection.mergedConnectionNames ?? []),
    ...(connection.__rootConnectionNames ?? []),
  ]
  for (const point of connection.pointsToConnect) {
    identifiers.push(
      point.pointId,
      point.pcb_port_id,
      connectivityPointIdentifier(point, pointLayers(point), layerCount),
    )
  }
  return identifiers.filter(
    (value): value is string => typeof value === "string",
  )
}

const pointLayers = (point: ConnectionPoint): string[] => {
  if ("layers" in point) return [...point.layers]
  return [point.layer]
}

const connectivityPointIdentifier = (
  point: Point,
  layers: readonly string[],
  layerCount: number,
): string => {
  const zLayers = layers
    .map((layer) => mapLayerNameToZ(layer, layerCount))
    .sort()
    .join("-")
  return `${Math.round(point.x * 100)},${Math.round(point.y * 100)}:${zLayers}`
}

const layersTraversedByVia = (
  fromLayer: string,
  toLayer: string,
  layerCount: number,
): string[] => {
  const fromZ = mapLayerNameToZ(fromLayer, layerCount)
  const toZ = mapLayerNameToZ(toLayer, layerCount)
  const firstZ = Math.min(fromZ, toZ)
  const lastZ = Math.max(fromZ, toZ)
  return Array.from({ length: lastZ - firstZ + 1 }, (_, offset) =>
    mapZToLayerName(firstZ + offset, layerCount),
  )
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

const isFinitePoint = (
  value: Record<string, unknown>,
): value is Record<string, unknown> & { x: number; y: number } => {
  return Number.isFinite(value.x) && Number.isFinite(value.y)
}

const pointIsOnSegment = (point: Point, segment: WireSegment): boolean => {
  const cross =
    (point.x - segment.start.x) * (segment.end.y - segment.start.y) -
    (point.y - segment.start.y) * (segment.end.x - segment.start.x)
  if (Math.abs(cross) > POINT_EPSILON) return false
  return (
    point.x >= Math.min(segment.start.x, segment.end.x) - POINT_EPSILON &&
    point.x <= Math.max(segment.start.x, segment.end.x) + POINT_EPSILON &&
    point.y >= Math.min(segment.start.y, segment.end.y) - POINT_EPSILON &&
    point.y <= Math.max(segment.start.y, segment.end.y) + POINT_EPSILON
  )
}

const pointsAreEqual = (left: Point, right: Point): boolean => {
  return (
    Math.abs(left.x - right.x) <= POINT_EPSILON &&
    Math.abs(left.y - right.y) <= POINT_EPSILON
  )
}

const tracesTouch = (
  left: PreparedTrace,
  right: PreparedTrace,
  consumeWork: () => void,
): boolean => {
  for (const leftSegment of left.segments) {
    for (const rightSegment of right.segments) {
      consumeWork()
      if (
        leftSegment.layer === rightSegment.layer &&
        doSegmentsIntersect(
          leftSegment.start,
          leftSegment.end,
          rightSegment.start,
          rightSegment.end,
        )
      ) {
        return true
      }
    }
    for (const via of right.vias) {
      consumeWork()
      if (
        via.layers.includes(leftSegment.layer) &&
        pointIsOnSegment(via.point, leftSegment)
      ) {
        return true
      }
    }
  }
  for (const leftVia of left.vias) {
    for (const rightSegment of right.segments) {
      consumeWork()
      if (
        leftVia.layers.includes(rightSegment.layer) &&
        pointIsOnSegment(leftVia.point, rightSegment)
      ) {
        return true
      }
    }
    for (const rightVia of right.vias) {
      consumeWork()
      if (
        pointsAreEqual(leftVia.point, rightVia.point) &&
        leftVia.layers.some((layer) => rightVia.layers.includes(layer))
      ) {
        return true
      }
    }
  }
  return false
}

const traceTouchesAnchor = (
  trace: PreparedTrace,
  anchor: Anchor,
  consumeWork: () => void,
): boolean => {
  for (const segment of trace.segments) {
    consumeWork()
    if (
      anchor.layers.includes(segment.layer) &&
      pointIsOnSegment(anchor.point, segment)
    ) {
      return true
    }
  }
  return trace.vias.some((via) => {
    consumeWork()
    return (
      pointsAreEqual(via.point, anchor.point) &&
      via.layers.some((layer) => anchor.layers.includes(layer))
    )
  })
}

const pointTouchesConnectedObstacle = (
  point: Point,
  layers: readonly string[],
  connectedObstacle: ConnectedObstacle,
): boolean => {
  const { obstacle } = connectedObstacle
  const rotationRadians = ((obstacle.ccwRotationDegrees ?? 0) * Math.PI) / 180
  const deltaX = point.x - obstacle.center.x
  const deltaY = point.y - obstacle.center.y
  const localX =
    deltaX * Math.cos(rotationRadians) + deltaY * Math.sin(rotationRadians)
  const localY =
    -deltaX * Math.sin(rotationRadians) + deltaY * Math.cos(rotationRadians)
  return (
    obstacle.layers.some((layer) => layers.includes(layer)) &&
    Math.abs(localX) <= obstacle.width / 2 + CONNECTED_OBSTACLE_TOLERANCE &&
    Math.abs(localY) <= obstacle.height / 2 + CONNECTED_OBSTACLE_TOLERANCE
  )
}

const traceTouchesConnectedObstacle = (
  trace: PreparedTrace,
  connectedObstacle: ConnectedObstacle,
  consumeWork: () => void,
): boolean => {
  return trace.endpoints.some((endpoint) => {
    consumeWork()
    return pointTouchesConnectedObstacle(
      endpoint.point,
      endpoint.layers,
      connectedObstacle,
    )
  })
}

const getIntersectionCoordinate = (
  left: WireSegment,
  right: WireSegment,
): Readonly<{ x: number; y: number }> | undefined => {
  const leftDx = left.end.x - left.start.x
  const leftDy = left.end.y - left.start.y
  const rightDx = right.end.x - right.start.x
  const rightDy = right.end.y - right.start.y
  const denominator = leftDx * rightDy - leftDy * rightDx
  if (Math.abs(denominator) <= POINT_EPSILON) return undefined
  const offsetX = right.start.x - left.start.x
  const offsetY = right.start.y - left.start.y
  const ratio = (offsetX * rightDy - offsetY * rightDx) / denominator
  return Object.freeze({
    x: left.start.x + ratio * leftDx,
    y: left.start.y + ratio * leftDy,
  })
}

const freezeResult = (
  diagnostics: AutorouterOutputDiagnostic[],
): AutorouterOutputValidationResult => {
  const frozenDiagnostics = diagnostics.map((diagnostic) =>
    Object.freeze({
      ...diagnostic,
      ...(diagnostic.coordinate
        ? { coordinate: Object.freeze({ ...diagnostic.coordinate }) }
        : {}),
    }),
  )
  return Object.freeze({
    valid: frozenDiagnostics.length === 0,
    diagnostics: Object.freeze(frozenDiagnostics),
  })
}

/**
 * Validates the topology of the complete returned SRJ trace set.
 *
 * This pure v1 helper validates every returned entry for route shape, declared layers, endpoint
 * connectivity, and different-connection same-layer crossings. Wire and via topology is modeled;
 * jumper and through-obstacle entries fail closed instead of being omitted. This deliberately does
 * not claim trace clearance, physical pad-shape validation, pad clearance, via clearance,
 * via-in-pad validity, or complete DRC. Declared rectangular obstacles are used only as connected
 * endpoint regions.
 */
const validateAutorouterOutputWithinBudget = ({
  inputSrj,
  outputSrj,
}: ValidateAutorouterOutputInput): AutorouterOutputValidationResult => {
  const connectionPointCount = inputSrj.connections.reduce(
    (count, connection) => count + connection.pointsToConnect.length,
    0,
  )
  if (
    inputSrj.connections.length > MAX_CONNECTIONS ||
    connectionPointCount > MAX_CONNECTION_POINTS ||
    inputSrj.obstacles.length > MAX_OBSTACLES
  ) {
    throw new ValidationBudgetExceeded()
  }
  const diagnostics: AutorouterOutputDiagnostic[] = []
  let validationWork = 0
  let identifierCharacters = 0
  const consumeWork = (): void => {
    validationWork++
    if (validationWork > MAX_VALIDATION_WORK) {
      throw new ValidationBudgetExceeded()
    }
  }
  const pushDiagnostic = (diagnostic: AutorouterOutputDiagnostic): void => {
    if (diagnostics.length >= MAX_DIAGNOSTICS) {
      throw new ValidationBudgetExceeded()
    }
    diagnostics.push(diagnostic)
  }
  const consumeIdentifier = (value: unknown): void => {
    if (typeof value !== "string") return
    if (value.length > MAX_IDENTIFIER_LENGTH)
      throw new ValidationBudgetExceeded()
    identifierCharacters += value.length
    if (identifierCharacters > MAX_TOTAL_IDENTIFIER_CHARACTERS) {
      throw new ValidationBudgetExceeded()
    }
  }
  for (const connection of inputSrj.connections) {
    const relationGroups = [
      connection.mergedConnectionNames ?? [],
      connection.__rootConnectionNames ?? [],
    ]
    if (
      relationGroups.some(
        (relations) => relations.length > MAX_RELATION_IDENTIFIERS_PER_ENTITY,
      )
    ) {
      throw new ValidationBudgetExceeded()
    }
    for (const value of [
      connection.name,
      connection.rootConnectionName,
      connection.netConnectionName,
      connection.__netConnectionName,
      ...relationGroups.flat(),
    ]) {
      consumeIdentifier(value)
    }
    for (const point of connection.pointsToConnect) {
      const layers = pointLayers(point)
      if (layers.length > MAX_LAYERS_PER_ENTITY) {
        throw new ValidationBudgetExceeded()
      }
      consumeIdentifier(point.pointId)
      consumeIdentifier(point.pcb_port_id)
      for (const layer of layers) consumeIdentifier(layer)
    }
  }
  for (const obstacle of inputSrj.obstacles) {
    if (
      obstacle.connectedTo.length > MAX_RELATION_IDENTIFIERS_PER_ENTITY ||
      (obstacle.offBoardConnectsTo?.length ?? 0) >
        MAX_RELATION_IDENTIFIERS_PER_ENTITY ||
      obstacle.layers.length > MAX_LAYERS_PER_ENTITY
    ) {
      throw new ValidationBudgetExceeded()
    }
    for (const value of [
      obstacle.obstacleId,
      ...obstacle.connectedTo,
      ...(obstacle.offBoardConnectsTo ?? []),
      ...obstacle.layers,
    ]) {
      consumeIdentifier(value)
    }
  }
  const connectivity = new IdentifierConnectivity()
  for (const connection of inputSrj.connections) {
    connectivity.addGroup(
      connectionIdentifiers(connection, inputSrj.layerCount),
    )
  }
  for (const obstacle of inputSrj.obstacles) {
    connectivity.addGroup(
      [
        obstacle.obstacleId,
        ...obstacle.connectedTo,
        ...(obstacle.offBoardConnectsTo ?? []),
        connectivityPointIdentifier(
          obstacle.center,
          obstacle.layers,
          inputSrj.layerCount,
        ),
      ].filter((value): value is string => typeof value === "string"),
    )
  }

  const connectionNameByOwner = new Map<string, string>()
  const anchorsByOwner = new Map<string, Anchor[]>()
  const anchorsByIdentifier = new Map<string, Anchor[]>()
  for (const connection of inputSrj.connections) {
    const owner = connectivity.find(connection.name)
    if (owner === null) continue
    if (!connectionNameByOwner.has(owner)) {
      connectionNameByOwner.set(owner, connection.name)
    }
    const ownerAnchors = anchorsByOwner.get(owner) ?? []
    for (const point of connection.pointsToConnect) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue
      const anchor: Anchor = {
        point: { x: point.x, y: point.y },
        layers: pointLayers(point),
        owner,
      }
      ownerAnchors.push(anchor)
      for (const identifier of [point.pointId, point.pcb_port_id]) {
        if (typeof identifier !== "string") continue
        const identifierAnchors = anchorsByIdentifier.get(identifier) ?? []
        identifierAnchors.push(anchor)
        anchorsByIdentifier.set(identifier, identifierAnchors)
      }
    }
    anchorsByOwner.set(owner, ownerAnchors)
  }
  const connectedObstacles = inputSrj.obstacles.flatMap((obstacle) => {
    const centerIdentifier = connectivityPointIdentifier(
      obstacle.center,
      obstacle.layers,
      inputSrj.layerCount,
    )
    const owner = connectivity.find(
      obstacle.obstacleId ??
        obstacle.connectedTo[0] ??
        obstacle.offBoardConnectsTo?.[0] ??
        centerIdentifier,
    )
    return owner === null
      ? []
      : [{ owner, obstacle } satisfies ConnectedObstacle]
  })

  const rawInputTraces: unknown[] = Array.isArray(inputSrj.traces)
    ? inputSrj.traces
    : []
  const rawOutputTraces: unknown[] = Array.isArray(outputSrj.traces)
    ? outputSrj.traces
    : []
  if (rawInputTraces.length + rawOutputTraces.length > MAX_TRACES) {
    throw new ValidationBudgetExceeded()
  }
  let totalRouteItems = 0
  for (const rawTrace of [...rawInputTraces, ...rawOutputTraces]) {
    if (!isRecord(rawTrace)) continue
    const traceRelations = Array.isArray(rawTrace.connectsTo)
      ? rawTrace.connectsTo
      : []
    if (traceRelations.length > MAX_RELATION_IDENTIFIERS_PER_ENTITY) {
      throw new ValidationBudgetExceeded()
    }
    for (const value of [
      rawTrace.pcb_trace_id,
      rawTrace.connection_name,
      rawTrace.__replaces_pcb_trace_id,
      ...traceRelations,
    ]) {
      consumeIdentifier(value)
    }
    if (!Array.isArray(rawTrace.route)) continue
    if (rawTrace.route.length > MAX_ROUTE_ITEMS_PER_TRACE) {
      throw new ValidationBudgetExceeded()
    }
    totalRouteItems += rawTrace.route.length
    if (totalRouteItems > MAX_TOTAL_ROUTE_ITEMS) {
      throw new ValidationBudgetExceeded()
    }
    for (const item of rawTrace.route) {
      if (!isRecord(item)) continue
      for (const value of [
        item.layer,
        item.from_layer,
        item.to_layer,
        item.start_pcb_port_id,
        item.end_pcb_port_id,
      ]) {
        consumeIdentifier(value)
      }
    }
  }
  const outputTraceIds = new Set(
    rawOutputTraces.flatMap((trace) => {
      if (!isRecord(trace)) return []
      return typeof trace.pcb_trace_id === "string" ? [trace.pcb_trace_id] : []
    }),
  )
  const replacedTraceIds = new Set(
    rawOutputTraces.flatMap((trace) => {
      if (!isRecord(trace)) return []
      return typeof trace.__replaces_pcb_trace_id === "string"
        ? [trace.__replaces_pcb_trace_id]
        : []
    }),
  )
  const rawTraces = [
    ...rawInputTraces.filter(
      (trace) =>
        !isRecord(trace) ||
        typeof trace.pcb_trace_id !== "string" ||
        (!replacedTraceIds.has(trace.pcb_trace_id) &&
          !outputTraceIds.has(trace.pcb_trace_id)),
    ),
    ...rawOutputTraces,
  ]

  const traceRecords = rawTraces.map((rawTrace) => {
    const trace = isRecord(rawTrace) ? rawTrace : {}
    const traceId =
      typeof trace.pcb_trace_id === "string"
        ? trace.pcb_trace_id
        : UNKNOWN_CONNECTION_NAME
    const connectionName =
      typeof trace.connection_name === "string"
        ? trace.connection_name
        : UNKNOWN_CONNECTION_NAME
    const connectsTo = Array.isArray(trace.connectsTo)
      ? trace.connectsTo.filter(
          (identifier): identifier is string => typeof identifier === "string",
        )
      : []
    const routePortIds = Array.isArray(trace.route)
      ? trace.route.flatMap((item) => {
          if (!isRecord(item)) return []
          return [item.start_pcb_port_id, item.end_pcb_port_id].filter(
            (identifier): identifier is string =>
              typeof identifier === "string",
          )
        })
      : []
    return {
      rawTrace: trace,
      traceId,
      connectionName,
      references: [connectionName, ...connectsTo, ...routePortIds],
      owner: null as string | null,
    }
  })

  const unresolved = new Set(traceRecords.map((_, index) => index))
  let madeProgress = true
  while (madeProgress && unresolved.size > 0) {
    madeProgress = false
    for (const traceIndex of [...unresolved]) {
      const trace = traceRecords[traceIndex]!
      const owners = new Set(
        trace.references
          .map((identifier) => connectivity.find(identifier))
          .filter(
            (owner): owner is string =>
              owner !== null && connectionNameByOwner.has(owner),
          ),
      )
      if (owners.size !== 1) continue
      trace.owner = [...owners][0]!
      connectivity.addGroup([
        trace.owner,
        trace.traceId,
        trace.connectionName,
        ...trace.references,
      ])
      unresolved.delete(traceIndex)
      madeProgress = true
    }
  }

  for (const traceIndex of unresolved) {
    const trace = traceRecords[traceIndex]!
    pushDiagnostic({
      code: "UNKNOWN_CONNECTION",
      connectionName: trace.connectionName,
      traceId: trace.traceId,
    })
  }

  const seenTraceIds = new Set<string>()
  const validLayers = new Set<string>(["top"])
  if (Number.isInteger(inputSrj.layerCount) && inputSrj.layerCount > 1) {
    validLayers.add("bottom")
    for (let index = 1; index < inputSrj.layerCount - 1; index++) {
      validLayers.add(`inner${index}`)
    }
  }

  const preparedTraces: PreparedTrace[] = []
  for (const traceRecord of traceRecords) {
    const { rawTrace, traceId, connectionName, owner, references } = traceRecord
    let shapeValid = true
    if (
      rawTrace.type !== "pcb_trace" ||
      traceId === UNKNOWN_CONNECTION_NAME ||
      connectionName === UNKNOWN_CONNECTION_NAME ||
      seenTraceIds.has(traceId)
    ) {
      pushDiagnostic({ code: "INVALID_SEGMENT", connectionName, traceId })
      shapeValid = false
    }
    seenTraceIds.add(traceId)
    if (!Array.isArray(rawTrace.route) || rawTrace.route.length < 2) {
      pushDiagnostic({ code: "INVALID_SEGMENT", connectionName, traceId })
      preparedTraces.push({
        traceId,
        connectionName,
        owner,
        references,
        segments: [],
        vias: [],
        endpoints: [],
        shapeValid: false,
      })
      continue
    }

    const locatedItems: Array<
      | Readonly<{
          kind: "wire"
          point: Point
          layer: string
          width: number
          routeIndex: number
        }>
      | Readonly<{
          kind: "via"
          point: Point
          layers: readonly string[]
          routeIndex: number
        }>
      | null
    > = []
    const vias: ViaPoint[] = []
    for (const [routeIndex, routeItem] of rawTrace.route.entries()) {
      if (!isRecord(routeItem) || typeof routeItem.route_type !== "string") {
        pushDiagnostic({
          code: "INVALID_SEGMENT",
          connectionName,
          traceId,
          segmentIndex: routeIndex,
        })
        locatedItems.push(null)
        shapeValid = false
        continue
      }
      if (routeItem.route_type === "wire") {
        if (!isFinitePoint(routeItem) || !Number.isFinite(routeItem.width)) {
          pushDiagnostic({
            code: "NON_FINITE_COORDINATE",
            connectionName,
            traceId,
            segmentIndex: routeIndex,
          })
          locatedItems.push(null)
          shapeValid = false
          continue
        }
        if (
          typeof routeItem.layer !== "string" ||
          !validLayers.has(routeItem.layer)
        ) {
          pushDiagnostic({
            code: "UNKNOWN_LAYER",
            connectionName,
            traceId,
            layer:
              typeof routeItem.layer === "string"
                ? routeItem.layer
                : UNKNOWN_CONNECTION_NAME,
            segmentIndex: routeIndex,
          })
          locatedItems.push(null)
          shapeValid = false
          continue
        }
        if (typeof routeItem.width !== "number" || routeItem.width <= 0) {
          pushDiagnostic({
            code: "INVALID_SEGMENT",
            connectionName,
            traceId,
            layer: routeItem.layer,
            segmentIndex: routeIndex,
          })
          locatedItems.push(null)
          shapeValid = false
          continue
        }
        locatedItems.push({
          kind: "wire",
          point: { x: routeItem.x, y: routeItem.y },
          layer: routeItem.layer,
          width: routeItem.width,
          routeIndex,
        })
        continue
      }
      if (routeItem.route_type === "via") {
        if (!isFinitePoint(routeItem)) {
          pushDiagnostic({
            code: "NON_FINITE_COORDINATE",
            connectionName,
            traceId,
            segmentIndex: routeIndex,
          })
          locatedItems.push(null)
          shapeValid = false
          continue
        }
        const optionalDimensions = [
          routeItem.via_diameter,
          routeItem.via_hole_diameter,
        ].filter((dimension) => dimension !== undefined)
        if (
          optionalDimensions.some(
            (dimension) =>
              typeof dimension !== "number" ||
              !Number.isFinite(dimension) ||
              dimension <= 0,
          )
        ) {
          pushDiagnostic({
            code: optionalDimensions.some(
              (dimension) =>
                typeof dimension === "number" && !Number.isFinite(dimension),
            )
              ? "NON_FINITE_COORDINATE"
              : "INVALID_SEGMENT",
            connectionName,
            traceId,
            segmentIndex: routeIndex,
          })
          locatedItems.push(null)
          shapeValid = false
          continue
        }
        const fromLayer = routeItem.from_layer
        const toLayer = routeItem.to_layer
        if (
          typeof fromLayer !== "string" ||
          typeof toLayer !== "string" ||
          !validLayers.has(fromLayer) ||
          !validLayers.has(toLayer)
        ) {
          pushDiagnostic({
            code: "UNKNOWN_LAYER",
            connectionName,
            traceId,
            layer:
              typeof fromLayer === "string" && !validLayers.has(fromLayer)
                ? fromLayer
                : typeof toLayer === "string"
                  ? toLayer
                  : UNKNOWN_CONNECTION_NAME,
            segmentIndex: routeIndex,
          })
          locatedItems.push(null)
          shapeValid = false
          continue
        }
        if (fromLayer === toLayer) {
          pushDiagnostic({
            code: "INVALID_SEGMENT",
            connectionName,
            traceId,
            layer: fromLayer,
            segmentIndex: routeIndex,
          })
          locatedItems.push(null)
          shapeValid = false
          continue
        }
        const via: ViaPoint = {
          point: { x: routeItem.x, y: routeItem.y },
          layers: layersTraversedByVia(
            fromLayer,
            toLayer,
            inputSrj.layerCount,
          ),
          routeIndex,
        }
        vias.push(via)
        locatedItems.push({ kind: "via", ...via })
        continue
      }
      pushDiagnostic({
        code: "INVALID_SEGMENT",
        connectionName,
        traceId,
        segmentIndex: routeIndex,
      })
      locatedItems.push(null)
      shapeValid = false
    }

    const segments: WireSegment[] = []
    for (let itemIndex = 0; itemIndex < locatedItems.length - 1; itemIndex++) {
      const current = locatedItems[itemIndex]
      const next = locatedItems[itemIndex + 1]
      if (current === null || next === null) continue
      if (current.kind === "wire" && next.kind === "wire") {
        if (
          current.layer !== next.layer ||
          pointsAreEqual(current.point, next.point)
        ) {
          pushDiagnostic({
            code: "INVALID_SEGMENT",
            connectionName,
            traceId,
            layer: current.layer,
            segmentIndex: current.routeIndex,
          })
          shapeValid = false
          continue
        }
        segments.push({
          start: current.point,
          end: next.point,
          layer: current.layer,
          routeIndex: current.routeIndex,
        })
        continue
      }
      if (current.kind === "via" && next.kind === "via") {
        pushDiagnostic({
          code: "INVALID_SEGMENT",
          connectionName,
          traceId,
          segmentIndex: current.routeIndex,
        })
        shapeValid = false
        continue
      }
      const wire =
        current.kind === "wire" ? current : next.kind === "wire" ? next : null
      const via =
        current.kind === "via" ? current : next.kind === "via" ? next : null
      if (wire === null || via === null) {
        pushDiagnostic({
          code: "INVALID_SEGMENT",
          connectionName,
          traceId,
          segmentIndex: Math.min(current.routeIndex, next.routeIndex),
        })
        shapeValid = false
        continue
      }
      if (
        !pointsAreEqual(wire.point, via.point) ||
        !via.layers.includes(wire.layer)
      ) {
        pushDiagnostic({
          code: "INVALID_SEGMENT",
          connectionName,
          traceId,
          layer: wire.layer,
          segmentIndex: Math.min(current.routeIndex, next.routeIndex),
        })
        shapeValid = false
      }
    }

    for (let itemIndex = 1; itemIndex < locatedItems.length - 1; itemIndex++) {
      const current = locatedItems[itemIndex]
      if (current?.kind !== "via") continue
      const previous = locatedItems[itemIndex - 1]
      const next = locatedItems[itemIndex + 1]
      if (
        previous?.kind !== "wire" ||
        next?.kind !== "wire" ||
        previous.layer === next.layer ||
        !current.layers.includes(previous.layer) ||
        !current.layers.includes(next.layer)
      ) {
        pushDiagnostic({
          code: "INVALID_SEGMENT",
          connectionName,
          traceId,
          segmentIndex: current.routeIndex,
        })
        shapeValid = false
      }
    }

    const first = locatedItems[0]
    const last = locatedItems[locatedItems.length - 1]
    const endpoints = [first, last].flatMap((item) => {
      if (item?.kind === "wire") {
        return [{ point: item.point, layers: [item.layer] }]
      }
      return item?.kind === "via"
        ? [{ point: item.point, layers: [...item.layers] }]
        : []
    })
    if (
      first === null ||
      first === undefined ||
      last === null ||
      last === undefined
    ) {
      pushDiagnostic({ code: "INVALID_SEGMENT", connectionName, traceId })
      shapeValid = false
    }
    preparedTraces.push({
      traceId,
      connectionName,
      owner,
      references,
      segments,
      vias,
      endpoints,
      shapeValid,
    })
  }

  for (let leftIndex = 0; leftIndex < preparedTraces.length; leftIndex++) {
    const left = preparedTraces[leftIndex]!
    if (!left.shapeValid || left.owner === null) continue
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < preparedTraces.length;
      rightIndex++
    ) {
      const right = preparedTraces[rightIndex]!
      if (
        !right.shapeValid ||
        right.owner === null ||
        left.owner === right.owner
      ) {
        continue
      }
      for (const leftSegment of left.segments) {
        for (const rightSegment of right.segments) {
          consumeWork()
          if (
            leftSegment.layer !== rightSegment.layer ||
            !doSegmentsIntersect(
              leftSegment.start,
              leftSegment.end,
              rightSegment.start,
              rightSegment.end,
            )
          ) {
            continue
          }
          pushDiagnostic({
            code: "DIFFERENT_CONNECTION_SAME_LAYER_CROSSING",
            connectionName: left.connectionName,
            traceId: left.traceId,
            peerConnectionName: right.connectionName,
            peerTraceId: right.traceId,
            layer: leftSegment.layer,
            segmentIndex: leftSegment.routeIndex,
            peerSegmentIndex: rightSegment.routeIndex,
            coordinate: getIntersectionCoordinate(leftSegment, rightSegment),
          })
        }
      }
    }
  }

  for (const trace of preparedTraces) {
    if (!trace.shapeValid || trace.owner === null) continue
    const peerTraces = preparedTraces.filter(
      (peer) => peer !== trace && peer.shapeValid && peer.owner === trace.owner,
    )
    const referencedAnchors = trace.references.flatMap(
      (reference) => anchorsByIdentifier.get(reference) ?? [],
    )
    const candidateAnchors =
      referencedAnchors.length > 0
        ? referencedAnchors
        : (anchorsByOwner.get(trace.owner) ?? [])
    const candidateObstacles = connectedObstacles.filter(
      (connectedObstacle) => {
        consumeWork()
        return connectedObstacle.owner === trace.owner
      },
    )
    for (const endpoint of trace.endpoints) {
      const touchesAnchor = candidateAnchors.some((anchor) => {
        consumeWork()
        return (
          anchor.layers.some((layer) => endpoint.layers.includes(layer)) &&
          pointsAreEqual(anchor.point, endpoint.point)
        )
      })
      const touchesObstacle = candidateObstacles.some((connectedObstacle) => {
        consumeWork()
        return pointTouchesConnectedObstacle(
          endpoint.point,
          endpoint.layers,
          connectedObstacle,
        )
      })
      const touchesPeer = peerTraces.some((peer) => {
        const touchesSegment = peer.segments.some((segment) => {
          consumeWork()
          return (
            endpoint.layers.includes(segment.layer) &&
            pointIsOnSegment(endpoint.point, segment)
          )
        })
        if (touchesSegment) return true
        return peer.vias.some((via) => {
          consumeWork()
          return (
            pointsAreEqual(endpoint.point, via.point) &&
            via.layers.some((layer) => endpoint.layers.includes(layer))
          )
        })
      })
      if (!touchesAnchor && !touchesObstacle && !touchesPeer) {
        pushDiagnostic({
          code: "DISCONNECTED_ROUTE_ENDPOINT",
          connectionName: trace.connectionName,
          traceId: trace.traceId,
          coordinate: endpoint.point,
        })
      }
    }
    for (const anchor of referencedAnchors) {
      const touchesAnchorObstacle = candidateObstacles.some(
        (connectedObstacle) => {
          consumeWork()
          return (
            pointTouchesConnectedObstacle(
              anchor.point,
              anchor.layers,
              connectedObstacle,
            ) &&
            traceTouchesConnectedObstacle(trace, connectedObstacle, consumeWork)
          )
        },
      )
      if (
        !traceTouchesAnchor(trace, anchor, consumeWork) &&
        !touchesAnchorObstacle
      ) {
        pushDiagnostic({
          code: "DISCONNECTED_ROUTE_ENDPOINT",
          connectionName: trace.connectionName,
          traceId: trace.traceId,
          coordinate: anchor.point,
        })
      }
    }
  }

  const tracesByOwner = new Map<string, PreparedTrace[]>()
  for (const trace of preparedTraces) {
    if (!trace.shapeValid || trace.owner === null) continue
    const ownerTraces = tracesByOwner.get(trace.owner) ?? []
    ownerTraces.push(trace)
    tracesByOwner.set(trace.owner, ownerTraces)
  }
  for (const [owner, ownerAnchors] of anchorsByOwner) {
    const ownerTraces = tracesByOwner.get(owner) ?? []
    if (ownerAnchors.length < 2) continue
    const traceParents = ownerTraces.map((_, index) => index)
    const findTrace = (index: number): number => {
      let root = index
      while (traceParents[root] !== root) root = traceParents[root]!
      while (traceParents[index] !== index) {
        const parent = traceParents[index]!
        traceParents[index] = root
        index = parent
      }
      return root
    }
    for (let leftIndex = 0; leftIndex < ownerTraces.length; leftIndex++) {
      for (
        let rightIndex = leftIndex + 1;
        rightIndex < ownerTraces.length;
        rightIndex++
      ) {
        const touchesSameConnectedObstacle = connectedObstacles.some(
          (connectedObstacle) => {
            consumeWork()
            return (
              connectedObstacle.owner === owner &&
              traceTouchesConnectedObstacle(
                ownerTraces[leftIndex]!,
                connectedObstacle,
                consumeWork,
              ) &&
              traceTouchesConnectedObstacle(
                ownerTraces[rightIndex]!,
                connectedObstacle,
                consumeWork,
              )
            )
          },
        )
        if (
          !tracesTouch(
            ownerTraces[leftIndex]!,
            ownerTraces[rightIndex]!,
            consumeWork,
          ) &&
          !touchesSameConnectedObstacle
        ) {
          continue
        }
        const leftRoot = findTrace(leftIndex)
        const rightRoot = findTrace(rightIndex)
        if (leftRoot !== rightRoot) traceParents[rightRoot] = leftRoot
      }
    }
    let expectedRoot: number | null = null
    for (const anchor of ownerAnchors) {
      const touchingTraceIndex = ownerTraces.findIndex(
        (trace) =>
          traceTouchesAnchor(trace, anchor, consumeWork) ||
          connectedObstacles.some((connectedObstacle) => {
            consumeWork()
            return (
              connectedObstacle.owner === owner &&
              pointTouchesConnectedObstacle(
                anchor.point,
                anchor.layers,
                connectedObstacle,
              ) &&
              traceTouchesConnectedObstacle(
                trace,
                connectedObstacle,
                consumeWork,
              )
            )
          }),
      )
      const touchingRoot =
        touchingTraceIndex === -1 ? null : findTrace(touchingTraceIndex)
      if (touchingRoot !== null && expectedRoot === null)
        expectedRoot = touchingRoot
      if (touchingRoot === null || touchingRoot !== expectedRoot) {
        pushDiagnostic({
          code: "DISCONNECTED_ROUTE_ENDPOINT",
          connectionName:
            connectionNameByOwner.get(owner) ?? UNKNOWN_CONNECTION_NAME,
          coordinate: anchor.point,
        })
      }
    }
  }

  return freezeResult(diagnostics)
}

/**
 * Validates untrusted autorouter output under fixed, non-configurable v1 limits.
 * Budget exhaustion fails closed with one generic INVALID_SEGMENT diagnostic.
 */
export const validateAutorouterOutput = (
  input: ValidateAutorouterOutputInput,
): AutorouterOutputValidationResult => {
  try {
    return validateAutorouterOutputWithinBudget(input)
  } catch (error) {
    if (error instanceof ValidationBudgetExceeded) {
      return freezeResult([
        {
          code: "INVALID_SEGMENT",
          connectionName: UNKNOWN_CONNECTION_NAME,
        },
      ])
    }
    throw error
  }
}

export const assertValidAutorouterOutput = (
  input: ValidateAutorouterOutputInput,
): void => {
  const result = validateAutorouterOutput(input)
  if (!result.valid) throw new AutorouterOutputValidationError(result)
}
