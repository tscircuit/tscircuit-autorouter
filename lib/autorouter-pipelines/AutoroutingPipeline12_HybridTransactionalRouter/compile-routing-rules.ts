import type {
  DifferentialPair,
  Obstacle,
  SimpleRouteBus,
  SimpleRouteConnection,
  SimpleRouteJson,
  SimplifiedPcbTrace,
} from "../../types"
import { getConnectivityMapFromSimpleRouteJson } from "../../utils/getConnectivityMapFromSimpleRouteJson"
import type {
  CompiledBusRules,
  CompiledClearanceRules,
  CompiledConnectionRules,
  CompiledDifferentialPairRules,
  CompiledLayerRule,
  CompiledLegalViaSpan,
  CompiledPreloadedCopper,
  CompiledRoutingRules,
  CompiledTerminal,
  CompiledViaBudget,
  ConnectionName,
  DeepReadonly,
  HybridBoardBounds,
  HybridBoardPoint,
  HybridConnectionClassAssignmentInput,
  HybridLegalViaSpanInput,
  HybridPowerRuleInput,
  HybridPreloadedCopperOwnershipInput,
  HybridRouteClassInput,
  HybridRoutingRulesInput,
  LayerName,
  PcbTraceId,
  RouteClassName,
} from "./types"

export type HybridRoutingRuleCompilationErrorCode =
  | "missing_rule"
  | "invalid_number"
  | "duplicate_identifier"
  | "unknown_connection"
  | "unknown_layer"
  | "contradictory_rule"
  | "impossible_geometry"

export class HybridRoutingRuleCompilationError extends Error {
  constructor(
    readonly code: HybridRoutingRuleCompilationErrorCode,
    readonly rulePath: string,
    message: string,
  ) {
    super(`${rulePath}: ${message}`)
    this.name = "HybridRoutingRuleCompilationError"
  }
}

type CompiledRouteClass = {
  readonly className: RouteClassName
  readonly traceWidthMm: number
  readonly allowedLayers: readonly LayerName[]
  readonly viaBudget: CompiledViaBudget
}

type ViaDimensions = {
  readonly viaHoleDiameterMm: number
  readonly viaPadDiameterMm: number
}

type ConnectionMembership = {
  readonly busByConnectionName: ReadonlyMap<ConnectionName, SimpleRouteBus>
  readonly differentialPairByConnectionName: ReadonlyMap<
    ConnectionName,
    DifferentialPair
  >
}

type RouteEntry = SimplifiedPcbTrace["route"][number]
type ViaSpanKey = string

function failCompilation(
  code: HybridRoutingRuleCompilationErrorCode,
  rulePath: string,
  message: string,
): never {
  throw new HybridRoutingRuleCompilationError(code, rulePath, message)
}

function requireFiniteNumber(
  candidate: number | undefined,
  rulePath: string,
): number {
  if (typeof candidate !== "number" || !Number.isFinite(candidate)) {
    failCompilation("missing_rule", rulePath, "must be a finite number")
  }
  return candidate
}

function requirePositiveNumber(
  candidate: number | undefined,
  rulePath: string,
): number {
  const resolvedNumber = requireFiniteNumber(candidate, rulePath)
  if (resolvedNumber <= 0) {
    failCompilation("invalid_number", rulePath, "must be greater than zero")
  }
  return resolvedNumber
}

function requireNonnegativeNumber(
  candidate: number | undefined,
  rulePath: string,
): number {
  const resolvedNumber = requireFiniteNumber(candidate, rulePath)
  if (resolvedNumber < 0) {
    failCompilation("invalid_number", rulePath, "must not be negative")
  }
  return resolvedNumber
}

function freezeList<Item>(items: readonly Item[]): readonly Item[] {
  const copiedItems = [...items]
  for (const item of copiedItems) {
    if (typeof item === "object" && item !== null) Object.freeze(item)
  }
  return Object.freeze(copiedItems)
}

function compileBoardBounds(simpleRouteJson: SimpleRouteJson): HybridBoardBounds {
  const { minX, maxX, minY, maxY } = simpleRouteJson.bounds
  for (const [coordinateName, coordinate] of Object.entries({
    minX,
    maxX,
    minY,
    maxY,
  })) {
    requireFiniteNumber(coordinate, `simpleRouteJson.bounds.${coordinateName}`)
  }
  if (minX >= maxX || minY >= maxY) {
    failCompilation(
      "impossible_geometry",
      "simpleRouteJson.bounds",
      "must describe a positive-area board",
    )
  }
  return Object.freeze({ minX, maxX, minY, maxY })
}

function getSignedOutlineArea(boardOutline: readonly HybridBoardPoint[]): number {
  let twiceSignedArea = 0
  for (let pointIndex = 0; pointIndex < boardOutline.length; pointIndex += 1) {
    const currentPoint = boardOutline[pointIndex]!
    const nextPoint = boardOutline[(pointIndex + 1) % boardOutline.length]!
    twiceSignedArea +=
      currentPoint.x * nextPoint.y - nextPoint.x * currentPoint.y
  }
  return twiceSignedArea / 2
}

function compileBoardOutline(
  simpleRouteJson: SimpleRouteJson,
  boardBounds: HybridBoardBounds,
): readonly HybridBoardPoint[] {
  const requestedOutline = simpleRouteJson.outline ?? [
    { x: boardBounds.minX, y: boardBounds.minY },
    { x: boardBounds.maxX, y: boardBounds.minY },
    { x: boardBounds.maxX, y: boardBounds.maxY },
    { x: boardBounds.minX, y: boardBounds.maxY },
  ]
  if (requestedOutline.length < 3) {
    failCompilation(
      "impossible_geometry",
      "simpleRouteJson.outline",
      "must contain at least three points",
    )
  }
  const boardOutline = requestedOutline.map((point, pointIndex) =>
    Object.freeze({
      x: requireFiniteNumber(
        point.x,
        `simpleRouteJson.outline[${pointIndex}].x`,
      ),
      y: requireFiniteNumber(
        point.y,
        `simpleRouteJson.outline[${pointIndex}].y`,
      ),
    }),
  )
  if (Math.abs(getSignedOutlineArea(boardOutline)) <= Number.EPSILON) {
    failCompilation(
      "impossible_geometry",
      "simpleRouteJson.outline",
      "must enclose a nonzero area",
    )
  }
  return freezeList(boardOutline)
}

function compileLayerStack(
  layerCount: number,
  routingRules: HybridRoutingRulesInput,
): readonly CompiledLayerRule[] {
  if (!Number.isInteger(layerCount) || layerCount < 1) {
    failCompilation(
      "invalid_number",
      "simpleRouteJson.layerCount",
      "must be a positive integer",
    )
  }
  if (routingRules.layerStack.length !== layerCount) {
    failCompilation(
      "contradictory_rule",
      "routingRules.layerStack",
      `must contain exactly ${layerCount} layers`,
    )
  }
  const layerNames = new Set<LayerName>()
  const zIndices = new Set<number>()
  const layerStack = routingRules.layerStack.map((layer, layerIndex) => {
    if (!layer.name.trim()) {
      failCompilation(
        "missing_rule",
        `routingRules.layerStack[${layerIndex}].name`,
        "must not be empty",
      )
    }
    if (layerNames.has(layer.name) || zIndices.has(layer.zIndex)) {
      failCompilation(
        "duplicate_identifier",
        `routingRules.layerStack[${layerIndex}]`,
        "layer names and z indexes must be unique",
      )
    }
    if (!Number.isInteger(layer.zIndex) || layer.zIndex < 0) {
      failCompilation(
        "invalid_number",
        `routingRules.layerStack[${layerIndex}].zIndex`,
        "must be a nonnegative integer",
      )
    }
    layerNames.add(layer.name)
    zIndices.add(layer.zIndex)
    return Object.freeze({ ...layer })
  })
  layerStack.sort((first, second) => first.zIndex - second.zIndex)
  for (let zIndex = 0; zIndex < layerStack.length; zIndex += 1) {
    if (layerStack[zIndex]!.zIndex !== zIndex) {
      failCompilation(
        "contradictory_rule",
        "routingRules.layerStack",
        "z indexes must form a contiguous zero-based stack",
      )
    }
  }
  return freezeList(layerStack)
}

function buildLayerByName(
  layerStack: readonly CompiledLayerRule[],
): ReadonlyMap<LayerName, CompiledLayerRule> {
  const layerByName = new Map<LayerName, CompiledLayerRule>()
  for (const layer of layerStack) {
    layerByName.set(layer.name, layer)
  }
  return layerByName
}

function compileAllowedLayers({
  requestedLayers,
  layerStack,
  layerByName,
  rulePath,
}: {
  requestedLayers: readonly LayerName[]
  layerStack: readonly CompiledLayerRule[]
  layerByName: ReadonlyMap<LayerName, CompiledLayerRule>
  rulePath: string
}): readonly LayerName[] {
  if (requestedLayers.length === 0) {
    failCompilation("missing_rule", rulePath, "must contain at least one layer")
  }
  const requestedLayerNames = new Set<LayerName>()
  for (const layerName of requestedLayers) {
    if (!layerByName.has(layerName)) {
      failCompilation("unknown_layer", rulePath, `contains ${layerName}`)
    }
    if (requestedLayerNames.has(layerName)) {
      failCompilation(
        "duplicate_identifier",
        rulePath,
        `contains duplicate layer ${layerName}`,
      )
    }
    requestedLayerNames.add(layerName)
  }
  return freezeList(
    layerStack
      .filter((layer) => requestedLayerNames.has(layer.name))
      .map((layer) => layer.name),
  )
}

function intersectAllowedLayers({
  firstLayers,
  secondLayers,
  layerStack,
  rulePath,
}: {
  firstLayers: readonly LayerName[]
  secondLayers: readonly LayerName[]
  layerStack: readonly CompiledLayerRule[]
  rulePath: string
}): readonly LayerName[] {
  const firstLayerNames = new Set(firstLayers)
  const secondLayerNames = new Set(secondLayers)
  const intersection = layerStack
    .filter(
      (layer) =>
        firstLayerNames.has(layer.name) && secondLayerNames.has(layer.name),
    )
    .map((layer) => layer.name)
  if (intersection.length === 0) {
    failCompilation(
      "contradictory_rule",
      rulePath,
      "has no layer permitted by every applicable rule",
    )
  }
  return freezeList(intersection)
}

function compileClearances(
  routingRules: HybridRoutingRulesInput,
): CompiledClearanceRules {
  const clearances = routingRules.clearances
  return Object.freeze({
    traceToTraceMm: requireNonnegativeNumber(
      clearances.traceToTraceMm,
      "routingRules.clearances.traceToTraceMm",
    ),
    traceToPadEdgeMm: requireNonnegativeNumber(
      clearances.traceToPadEdgeMm,
      "routingRules.clearances.traceToPadEdgeMm",
    ),
    viaToTraceEdgeMm: requireNonnegativeNumber(
      clearances.viaToTraceEdgeMm,
      "routingRules.clearances.viaToTraceEdgeMm",
    ),
    viaToPadEdgeMm: requireNonnegativeNumber(
      clearances.viaToPadEdgeMm,
      "routingRules.clearances.viaToPadEdgeMm",
    ),
    boardEdgeMm: requireNonnegativeNumber(
      clearances.boardEdgeMm,
      "routingRules.clearances.boardEdgeMm",
    ),
  })
}

function compileViaDimensions(simpleRouteJson: SimpleRouteJson): ViaDimensions {
  const viaHoleDiameterMm = requirePositiveNumber(
    simpleRouteJson.min_via_hole_diameter ??
      simpleRouteJson.minViaHoleDiameter,
    "simpleRouteJson.minViaHoleDiameter",
  )
  const viaPadDiameterMm = requirePositiveNumber(
    simpleRouteJson.min_via_pad_diameter ??
      simpleRouteJson.minViaPadDiameter ??
      simpleRouteJson.minViaDiameter,
    "simpleRouteJson.minViaPadDiameter",
  )
  if (viaPadDiameterMm <= viaHoleDiameterMm) {
    failCompilation(
      "impossible_geometry",
      "simpleRouteJson.minViaPadDiameter",
      "must be larger than the via hole diameter",
    )
  }
  return Object.freeze({ viaHoleDiameterMm, viaPadDiameterMm })
}

function getViaSpanKey({
  fromLayer,
  toLayer,
  layerByName,
}: HybridLegalViaSpanInput & {
  layerByName: ReadonlyMap<LayerName, CompiledLayerRule>
}): ViaSpanKey {
  const fromZ = layerByName.get(fromLayer)?.zIndex
  const toZ = layerByName.get(toLayer)?.zIndex
  if (fromZ === undefined || toZ === undefined) return `${fromLayer}:${toLayer}`
  return fromZ < toZ ? `${fromZ}:${toZ}` : `${toZ}:${fromZ}`
}

function compileLegalViaSpans({
  routingRules,
  layerStack,
  layerByName,
}: {
  routingRules: HybridRoutingRulesInput
  layerStack: readonly CompiledLayerRule[]
  layerByName: ReadonlyMap<LayerName, CompiledLayerRule>
}): readonly CompiledLegalViaSpan[] {
  if (layerStack.length > 1 && routingRules.legalViaSpans.length === 0) {
    failCompilation(
      "missing_rule",
      "routingRules.legalViaSpans",
      "must declare legal spans for a multilayer board",
    )
  }
  const spanKeys = new Set<ViaSpanKey>()
  const legalViaSpans = routingRules.legalViaSpans.map((span, spanIndex) => {
    const fromLayer = layerByName.get(span.fromLayer)
    const toLayer = layerByName.get(span.toLayer)
    if (!fromLayer || !toLayer) {
      failCompilation(
        "unknown_layer",
        `routingRules.legalViaSpans[${spanIndex}]`,
        "references a layer outside the compiled stack",
      )
    }
    if (fromLayer.zIndex === toLayer.zIndex) {
      failCompilation(
        "contradictory_rule",
        `routingRules.legalViaSpans[${spanIndex}]`,
        "must connect two different layers",
      )
    }
    const spanKey = getViaSpanKey({
      fromLayer: span.fromLayer,
      toLayer: span.toLayer,
      layerByName,
    })
    if (spanKeys.has(spanKey)) {
      failCompilation(
        "duplicate_identifier",
        `routingRules.legalViaSpans[${spanIndex}]`,
        "duplicates an existing undirected via span",
      )
    }
    spanKeys.add(spanKey)
    const [startLayer, endLayer] =
      fromLayer.zIndex < toLayer.zIndex
        ? [fromLayer, toLayer]
        : [toLayer, fromLayer]
    return Object.freeze({
      startLayer: startLayer.name,
      endLayer: endLayer.name,
      startZ: startLayer.zIndex,
      endZ: endLayer.zIndex,
    })
  })
  return freezeList(legalViaSpans)
}

function compileViaBudget(
  viaBudget: HybridRouteClassInput["viaBudget"],
  rulePath: string,
): CompiledViaBudget {
  const softMaximum = requireNonnegativeNumber(
    viaBudget.softMaximum,
    `${rulePath}.softMaximum`,
  )
  const hardMaximum = requireNonnegativeNumber(
    viaBudget.hardMaximum,
    `${rulePath}.hardMaximum`,
  )
  if (!Number.isInteger(softMaximum) || !Number.isInteger(hardMaximum)) {
    failCompilation(
      "invalid_number",
      rulePath,
      "via budgets must be integer counts",
    )
  }
  if (softMaximum > hardMaximum) {
    failCompilation(
      "contradictory_rule",
      rulePath,
      "soft maximum must not exceed hard maximum",
    )
  }
  return Object.freeze({ softMaximum, hardMaximum })
}

function compileRouteClasses({
  simpleRouteJson,
  routingRules,
  layerStack,
  layerByName,
}: {
  simpleRouteJson: SimpleRouteJson
  routingRules: HybridRoutingRulesInput
  layerStack: readonly CompiledLayerRule[]
  layerByName: ReadonlyMap<LayerName, CompiledLayerRule>
}): readonly CompiledRouteClass[] {
  if (routingRules.routeClasses.length === 0) {
    failCompilation(
      "missing_rule",
      "routingRules.routeClasses",
      "must contain at least one route class",
    )
  }
  const classNames = new Set<RouteClassName>()
  const minimumTraceWidthMm = requirePositiveNumber(
    simpleRouteJson.minTraceWidth,
    "simpleRouteJson.minTraceWidth",
  )
  const routeClasses = routingRules.routeClasses.map((routeClass, classIndex) => {
    const rulePath = `routingRules.routeClasses[${classIndex}]`
    if (!routeClass.className.trim()) {
      failCompilation(
        "missing_rule",
        `${rulePath}.className`,
        "must not be empty",
      )
    }
    if (classNames.has(routeClass.className)) {
      failCompilation(
        "duplicate_identifier",
        `${rulePath}.className`,
        `duplicates ${routeClass.className}`,
      )
    }
    classNames.add(routeClass.className)
    const traceWidthMm = requirePositiveNumber(
      routeClass.traceWidthMm,
      `${rulePath}.traceWidthMm`,
    )
    if (traceWidthMm < minimumTraceWidthMm) {
      failCompilation(
        "contradictory_rule",
        `${rulePath}.traceWidthMm`,
        "must not be smaller than simpleRouteJson.minTraceWidth",
      )
    }
    return Object.freeze({
      className: routeClass.className,
      traceWidthMm,
      allowedLayers: compileAllowedLayers({
        requestedLayers: routeClass.allowedLayers,
        layerStack,
        layerByName,
        rulePath: `${rulePath}.allowedLayers`,
      }),
      viaBudget: compileViaBudget(routeClass.viaBudget, `${rulePath}.viaBudget`),
    })
  })
  return freezeList(routeClasses)
}

function buildConnectionByName(
  simpleRouteJson: SimpleRouteJson,
): ReadonlyMap<ConnectionName, SimpleRouteConnection> {
  const connectionByName = new Map<ConnectionName, SimpleRouteConnection>()
  for (const [connectionIndex, connection] of simpleRouteJson.connections.entries()) {
    if (!connection.name.trim()) {
      failCompilation(
        "missing_rule",
        `simpleRouteJson.connections[${connectionIndex}].name`,
        "must not be empty",
      )
    }
    if (connectionByName.has(connection.name)) {
      failCompilation(
        "duplicate_identifier",
        `simpleRouteJson.connections[${connectionIndex}].name`,
        `duplicates ${connection.name}`,
      )
    }
    connectionByName.set(connection.name, connection)
  }
  return connectionByName
}

function buildMembership({
  simpleRouteJson,
  connectionByName,
}: {
  simpleRouteJson: SimpleRouteJson
  connectionByName: ReadonlyMap<ConnectionName, SimpleRouteConnection>
}): ConnectionMembership {
  const busByConnectionName = new Map<ConnectionName, SimpleRouteBus>()
  for (const [busIndex, bus] of (simpleRouteJson.buses ?? []).entries()) {
    if (!bus.busId.trim() || bus.connectionNames.length < 2) {
      failCompilation(
        "missing_rule",
        `simpleRouteJson.buses[${busIndex}]`,
        "must have an id and at least two ordered connections",
      )
    }
    const busConnectionNames = new Set<ConnectionName>()
    for (const connectionName of bus.connectionNames) {
      if (!connectionByName.has(connectionName)) {
        failCompilation(
          "unknown_connection",
          `simpleRouteJson.buses[${busIndex}].connectionNames`,
          `references ${connectionName}`,
        )
      }
      if (
        busConnectionNames.has(connectionName) ||
        busByConnectionName.has(connectionName)
      ) {
        failCompilation(
          "duplicate_identifier",
          `simpleRouteJson.buses[${busIndex}].connectionNames`,
          `${connectionName} has more than one bus ownership rule`,
        )
      }
      busConnectionNames.add(connectionName)
      busByConnectionName.set(connectionName, bus)
    }
  }
  const differentialPairByConnectionName = new Map<
    ConnectionName,
    DifferentialPair
  >()
  for (const [pairIndex, pair] of (
    simpleRouteJson.differentialPairs ?? []
  ).entries()) {
    const [firstConnectionName, secondConnectionName] = pair.connectionNames
    if (
      firstConnectionName === secondConnectionName ||
      !connectionByName.has(firstConnectionName) ||
      !connectionByName.has(secondConnectionName)
    ) {
      failCompilation(
        "unknown_connection",
        `simpleRouteJson.differentialPairs[${pairIndex}].connectionNames`,
        "must reference two different existing connections",
      )
    }
    if (
      differentialPairByConnectionName.has(firstConnectionName) ||
      differentialPairByConnectionName.has(secondConnectionName)
    ) {
      failCompilation(
        "duplicate_identifier",
        `simpleRouteJson.differentialPairs[${pairIndex}].connectionNames`,
        "a connection may belong to only one differential pair",
      )
    }
    const firstBus = busByConnectionName.get(firstConnectionName)
    const secondBus = busByConnectionName.get(secondConnectionName)
    if (firstBus?.busId !== secondBus?.busId) {
      failCompilation(
        "contradictory_rule",
        `simpleRouteJson.differentialPairs[${pairIndex}]`,
        "pair members must either share one bus or both be outside a bus",
      )
    }
    if (firstBus) {
      const firstBusIndex = firstBus.connectionNames.indexOf(firstConnectionName)
      const secondBusIndex = firstBus.connectionNames.indexOf(secondConnectionName)
      if (Math.abs(firstBusIndex - secondBusIndex) !== 1) {
        failCompilation(
          "contradictory_rule",
          `simpleRouteJson.differentialPairs[${pairIndex}]`,
          "differential-pair members inside a bus must be adjacent in bus order",
        )
      }
    }
    differentialPairByConnectionName.set(firstConnectionName, pair)
    differentialPairByConnectionName.set(secondConnectionName, pair)
  }
  return Object.freeze({ busByConnectionName, differentialPairByConnectionName })
}

function buildAssignmentByConnectionName({
  routingRules,
  connectionByName,
}: {
  routingRules: HybridRoutingRulesInput
  connectionByName: ReadonlyMap<ConnectionName, SimpleRouteConnection>
}): ReadonlyMap<ConnectionName, HybridConnectionClassAssignmentInput> {
  const assignmentByConnectionName = new Map<
    ConnectionName,
    HybridConnectionClassAssignmentInput
  >()
  for (const [assignmentIndex, assignment] of (
    routingRules.connectionClassAssignments
  ).entries()) {
    if (!connectionByName.has(assignment.connectionName)) {
      failCompilation(
        "unknown_connection",
        `routingRules.connectionClassAssignments[${assignmentIndex}]`,
        `references ${assignment.connectionName}`,
      )
    }
    if (assignmentByConnectionName.has(assignment.connectionName)) {
      failCompilation(
        "duplicate_identifier",
        `routingRules.connectionClassAssignments[${assignmentIndex}]`,
        `duplicates ${assignment.connectionName}`,
      )
    }
    assignmentByConnectionName.set(assignment.connectionName, assignment)
  }
  for (const connectionName of connectionByName.keys()) {
    if (!assignmentByConnectionName.has(connectionName)) {
      failCompilation(
        "missing_rule",
        "routingRules.connectionClassAssignments",
        `has no route class for ${connectionName}`,
      )
    }
  }
  return assignmentByConnectionName
}

function buildPowerRuleByConnectionName({
  routingRules,
  connectionByName,
  membership,
}: {
  routingRules: HybridRoutingRulesInput
  connectionByName: ReadonlyMap<ConnectionName, SimpleRouteConnection>
  membership: ConnectionMembership
}): ReadonlyMap<ConnectionName, HybridPowerRuleInput> {
  const powerRuleByConnectionName = new Map<
    ConnectionName,
    HybridPowerRuleInput
  >()
  for (const [powerRuleIndex, powerRule] of (
    routingRules.powerRules ?? []
  ).entries()) {
    if (!connectionByName.has(powerRule.connectionName)) {
      failCompilation(
        "unknown_connection",
        `routingRules.powerRules[${powerRuleIndex}]`,
        `references ${powerRule.connectionName}`,
      )
    }
    if (powerRuleByConnectionName.has(powerRule.connectionName)) {
      failCompilation(
        "duplicate_identifier",
        `routingRules.powerRules[${powerRuleIndex}]`,
        `duplicates ${powerRule.connectionName}`,
      )
    }
    if (
      membership.busByConnectionName.has(powerRule.connectionName) ||
      membership.differentialPairByConnectionName.has(powerRule.connectionName)
    ) {
      failCompilation(
        "contradictory_rule",
        `routingRules.powerRules[${powerRuleIndex}]`,
        "power connections cannot also be bus or differential-pair members",
      )
    }
    const powerConnection = connectionByName.get(powerRule.connectionName)!
    if (
      powerRule.topology === "point_to_point" &&
      powerConnection.pointsToConnect.length !== 2
    ) {
      failCompilation(
        "impossible_geometry",
        `routingRules.powerRules[${powerRuleIndex}].topology`,
        "point_to_point power routing requires exactly two terminals",
      )
    }
    if (
      powerRule.topology === "mesh" &&
      powerConnection.pointsToConnect.length < 3
    ) {
      failCompilation(
        "impossible_geometry",
        `routingRules.powerRules[${powerRuleIndex}].topology`,
        "mesh power routing requires at least three terminals",
      )
    }
    powerRuleByConnectionName.set(powerRule.connectionName, powerRule)
  }
  return powerRuleByConnectionName
}

function compileTerminals({
  connection,
  connectionIndex,
  allowedLayers,
  layerStack,
  layerByName,
  viaPadDiameterMm,
}: {
  connection: SimpleRouteConnection
  connectionIndex: number
  allowedLayers: readonly LayerName[]
  layerStack: readonly CompiledLayerRule[]
  layerByName: ReadonlyMap<LayerName, CompiledLayerRule>
  viaPadDiameterMm: number
}): readonly CompiledTerminal[] {
  if (connection.pointsToConnect.length < 1) {
    failCompilation(
      "impossible_geometry",
      `simpleRouteJson.connections[${connectionIndex}].pointsToConnect`,
      "must contain at least one terminal",
    )
  }
  const terminalIds = new Set<CompiledTerminal["terminalId"]>()
  const terminals = connection.pointsToConnect.map((point, terminalIndex) => {
    const rulePath = `simpleRouteJson.connections[${connectionIndex}].pointsToConnect[${terminalIndex}]`
    const requestedLayers = "layers" in point ? point.layers : [point.layer]
    const compiledPointLayers = compileAllowedLayers({
      requestedLayers,
      layerStack,
      layerByName,
      rulePath: `${rulePath}.layers`,
    })
    const terminalLayers = intersectAllowedLayers({
      firstLayers: compiledPointLayers,
      secondLayers: allowedLayers,
      layerStack,
      rulePath: `${rulePath}.layers`,
    })
    const terminalId =
      point.pointId ??
      point.pcb_port_id ??
      `${connection.name}:terminal:${terminalIndex}`
    if (terminalIds.has(terminalId)) {
      failCompilation(
        "duplicate_identifier",
        `${rulePath}.pointId`,
        `duplicates terminal identity ${terminalId}`,
      )
    }
    terminalIds.add(terminalId)
    let terminalVia: CompiledTerminal["terminalVia"]
    if ("terminalVia" in point && point.terminalVia) {
      if (!layerByName.has(point.terminalVia.toLayer)) {
        failCompilation(
          "unknown_layer",
          `${rulePath}.terminalVia.toLayer`,
          `references ${point.terminalVia.toLayer}`,
        )
      }
      const terminalViaDiameterMm =
        point.terminalVia.viaDiameter ?? viaPadDiameterMm
      if (terminalViaDiameterMm < viaPadDiameterMm) {
        failCompilation(
          "contradictory_rule",
          `${rulePath}.terminalVia.viaDiameter`,
          "must not be smaller than the compiled via pad diameter",
        )
      }
      terminalVia = Object.freeze({
        toLayer: point.terminalVia.toLayer,
        viaPadDiameterMm: terminalViaDiameterMm,
      })
    }
    return Object.freeze({
      terminalId,
      x: requireFiniteNumber(point.x, `${rulePath}.x`),
      y: requireFiniteNumber(point.y, `${rulePath}.y`),
      layers: terminalLayers,
      pcbPortId: point.pcb_port_id,
      terminalVia,
    })
  })
  return freezeList(terminals)
}

function compileConnections({
  simpleRouteJson,
  routingRules,
  routeClasses,
  assignmentByConnectionName,
  powerRuleByConnectionName,
  membership,
  layerStack,
  layerByName,
  viaPadDiameterMm,
}: {
  simpleRouteJson: SimpleRouteJson
  routingRules: HybridRoutingRulesInput
  routeClasses: readonly CompiledRouteClass[]
  assignmentByConnectionName: ReadonlyMap<
    ConnectionName,
    HybridConnectionClassAssignmentInput
  >
  powerRuleByConnectionName: ReadonlyMap<ConnectionName, HybridPowerRuleInput>
  membership: ConnectionMembership
  layerStack: readonly CompiledLayerRule[]
  layerByName: ReadonlyMap<LayerName, CompiledLayerRule>
  viaPadDiameterMm: number
}): readonly CompiledConnectionRules[] {
  const connectivityMap = getConnectivityMapFromSimpleRouteJson(simpleRouteJson)
  const orderedConnectionNames = simpleRouteJson.connections
    .map((connection) => connection.name)
    .sort((first, second) => first.localeCompare(second))
  const routeClassByName = new Map<RouteClassName, CompiledRouteClass>(
    routeClasses.map((routeClass) => [routeClass.className, routeClass]),
  )
  const minimumTraceWidthMm = simpleRouteJson.minTraceWidth
  const connections = simpleRouteJson.connections.map(
    (connection, connectionIndex): CompiledConnectionRules => {
      const assignment = assignmentByConnectionName.get(connection.name)!
      const routeClass = routeClassByName.get(assignment.className)
      if (!routeClass) {
        failCompilation(
          "missing_rule",
          `routingRules.connectionClassAssignments[${connectionIndex}].className`,
          `references unknown class ${assignment.className}`,
        )
      }
      const bus = membership.busByConnectionName.get(connection.name)
      const powerRule = powerRuleByConnectionName.get(connection.name)
      const assignmentLayers = assignment.allowedLayers
        ? compileAllowedLayers({
            requestedLayers: assignment.allowedLayers,
            layerStack,
            layerByName,
            rulePath: `routingRules.connectionClassAssignments.${connection.name}.allowedLayers`,
          })
        : routeClass.allowedLayers
      let allowedLayers = intersectAllowedLayers({
        firstLayers: routeClass.allowedLayers,
        secondLayers: assignmentLayers,
        layerStack,
        rulePath: `routingRules.connectionClassAssignments.${connection.name}.allowedLayers`,
      })
      if (bus?.allowedLayers) {
        const busLayers = compileAllowedLayers({
          requestedLayers: bus.allowedLayers,
          layerStack,
          layerByName,
          rulePath: `simpleRouteJson.buses.${bus.busId}.allowedLayers`,
        })
        allowedLayers = intersectAllowedLayers({
          firstLayers: allowedLayers,
          secondLayers: busLayers,
          layerStack,
          rulePath: `simpleRouteJson.buses.${bus.busId}.allowedLayers`,
        })
      }
      if (powerRule?.allowedLayers) {
        const powerLayers = compileAllowedLayers({
          requestedLayers: powerRule.allowedLayers,
          layerStack,
          layerByName,
          rulePath: `routingRules.powerRules.${connection.name}.allowedLayers`,
        })
        allowedLayers = intersectAllowedLayers({
          firstLayers: allowedLayers,
          secondLayers: powerLayers,
          layerStack,
          rulePath: `routingRules.powerRules.${connection.name}.allowedLayers`,
        })
      }
      const traceWidthMm = requirePositiveNumber(
        powerRule?.traceWidthMm ??
          connection.nominalTraceWidth ??
          bus?.traceWidth ??
          routeClass.traceWidthMm,
        `compiledConnections.${connection.name}.traceWidthMm`,
      )
      if (traceWidthMm < minimumTraceWidthMm) {
        failCompilation(
          "contradictory_rule",
          `compiledConnections.${connection.name}.traceWidthMm`,
          "must not be smaller than simpleRouteJson.minTraceWidth",
        )
      }
      const viaBudget = assignment.viaBudget
        ? compileViaBudget(
            assignment.viaBudget,
            `routingRules.connectionClassAssignments.${connection.name}.viaBudget`,
          )
        : routeClass.viaBudget
      const commonRules = {
        connectionName: connection.name,
        electricallyConnectedConnectionNames: freezeList(
          orderedConnectionNames.filter((candidateName) =>
            candidateName === connection.name ||
            connectivityMap.areIdsConnected(connection.name, candidateName),
          ),
        ),
        className: routeClass.className,
        traceWidthMm,
        allowedLayers,
        viaBudget,
        terminals: compileTerminals({
          connection,
          connectionIndex,
          allowedLayers,
          layerStack,
          layerByName,
          viaPadDiameterMm,
        }),
      }
      return powerRule
        ? Object.freeze({
            ...commonRules,
            kind: "power" as const,
            topology: powerRule.topology,
          })
        : Object.freeze({ ...commonRules, kind: "signal" as const })
    },
  )
  if (
    routingRules.connectionClassAssignments.length !== simpleRouteJson.connections.length
  ) {
    failCompilation(
      "contradictory_rule",
      "routingRules.connectionClassAssignments",
      "must contain exactly one assignment per connection",
    )
  }
  return freezeList(connections)
}

function compileDifferentialPairs({
  simpleRouteJson,
  connections,
  layerStack,
}: {
  simpleRouteJson: SimpleRouteJson
  connections: readonly CompiledConnectionRules[]
  layerStack: readonly CompiledLayerRule[]
}): readonly CompiledDifferentialPairRules[] {
  const connectionByName = new Map<ConnectionName, CompiledConnectionRules>(
    connections.map((connection) => [connection.connectionName, connection]),
  )
  const differentialPairs = (simpleRouteJson.differentialPairs ?? []).map(
    (pair, pairIndex) => {
      const [firstName, secondName] = pair.connectionNames
      const firstConnection = connectionByName.get(firstName)!
      const secondConnection = connectionByName.get(secondName)!
      if (firstConnection.kind !== "signal" || secondConnection.kind !== "signal") {
        failCompilation(
          "contradictory_rule",
          `simpleRouteJson.differentialPairs[${pairIndex}]`,
          "power connections cannot be differential-pair members",
        )
      }
      const spacingMm = requirePositiveNumber(
        pair.traceGap,
        `simpleRouteJson.differentialPairs[${pairIndex}].traceGap`,
      )
      const maximumSkewMm = requireNonnegativeNumber(
        pair.lengthTolerance,
        `simpleRouteJson.differentialPairs[${pairIndex}].lengthTolerance`,
      )
      const maximumUncoupledLengthMm = requireNonnegativeNumber(
        pair.maxUncoupledLength,
        `simpleRouteJson.differentialPairs[${pairIndex}].maxUncoupledLength`,
      )
      return Object.freeze({
        connectionNames: Object.freeze([firstName, secondName]) as readonly [
          ConnectionName,
          ConnectionName,
        ],
        spacingMm,
        maximumSkewMm,
        maximumUncoupledLengthMm,
        allowedLayers: intersectAllowedLayers({
          firstLayers: firstConnection.allowedLayers,
          secondLayers: secondConnection.allowedLayers,
          layerStack,
          rulePath: `simpleRouteJson.differentialPairs[${pairIndex}].allowedLayers`,
        }),
      })
    },
  )
  return freezeList(differentialPairs)
}

function compileBuses({
  simpleRouteJson,
  connections,
  layerStack,
}: {
  simpleRouteJson: SimpleRouteJson
  connections: readonly CompiledConnectionRules[]
  layerStack: readonly CompiledLayerRule[]
}): readonly CompiledBusRules[] {
  const connectionByName = new Map<ConnectionName, CompiledConnectionRules>(
    connections.map((connection) => [connection.connectionName, connection]),
  )
  const busIds = new Set<string>()
  const buses = (simpleRouteJson.buses ?? []).map((bus, busIndex) => {
    if (busIds.has(bus.busId)) {
      failCompilation(
        "duplicate_identifier",
        `simpleRouteJson.buses[${busIndex}].busId`,
        `duplicates ${bus.busId}`,
      )
    }
    busIds.add(bus.busId)
    const memberConnections = bus.connectionNames.map((connectionName) => {
      const connection = connectionByName.get(connectionName)!
      if (connection.kind !== "signal") {
        failCompilation(
          "contradictory_rule",
          `simpleRouteJson.buses[${busIndex}]`,
          "power connections cannot be bus members",
        )
      }
      return connection
    })
    let allowedLayers = memberConnections[0]!.allowedLayers
    for (const connection of memberConnections.slice(1)) {
      allowedLayers = intersectAllowedLayers({
        firstLayers: allowedLayers,
        secondLayers: connection.allowedLayers,
        layerStack,
        rulePath: `simpleRouteJson.buses[${busIndex}].allowedLayers`,
      })
    }
    return Object.freeze({
      busId: bus.busId,
      orderedConnectionNames: freezeList(bus.connectionNames),
      maximumSkewMm: requireNonnegativeNumber(
        bus.maxLengthSkew,
        `simpleRouteJson.buses[${busIndex}].maxLengthSkew`,
      ),
      allowedLayers,
    })
  })
  return freezeList(buses)
}

function validateObstacle(
  obstacle: Obstacle,
  obstacleIndex: number,
  layerByName: ReadonlyMap<LayerName, CompiledLayerRule>,
): DeepReadonly<Obstacle> {
  const rulePath = `simpleRouteJson.obstacles[${obstacleIndex}]`
  if (obstacle.layers.length === 0) {
    failCompilation("missing_rule", `${rulePath}.layers`, "must not be empty")
  }
  for (const layerName of obstacle.layers) {
    if (!layerByName.has(layerName)) {
      failCompilation(
        "unknown_layer",
        `${rulePath}.layers`,
        `contains ${layerName}`,
      )
    }
  }
  const compiledObstacle: DeepReadonly<Obstacle> = {
    ...obstacle,
    center: Object.freeze({
      x: requireFiniteNumber(obstacle.center.x, `${rulePath}.center.x`),
      y: requireFiniteNumber(obstacle.center.y, `${rulePath}.center.y`),
    }),
    width: requirePositiveNumber(obstacle.width, `${rulePath}.width`),
    height: requirePositiveNumber(obstacle.height, `${rulePath}.height`),
    layers: freezeList(obstacle.layers),
    zLayers: obstacle.zLayers ? freezeList(obstacle.zLayers) : undefined,
    __zLayers: obstacle.__zLayers
      ? freezeList(obstacle.__zLayers)
      : undefined,
    connectedTo: freezeList(obstacle.connectedTo),
    offBoardConnectsTo: obstacle.offBoardConnectsTo
      ? freezeList(obstacle.offBoardConnectsTo)
      : undefined,
    circuitJsonMetadata: obstacle.circuitJsonMetadata
      ? Object.freeze({ ...obstacle.circuitJsonMetadata })
      : undefined,
  }
  return Object.freeze(compiledObstacle)
}

function normalizePreloadedRouteEntry({
  routeEntry,
  routeEntryPath,
  minimumTraceWidthMm,
  viaDimensions,
  layerByName,
  legalViaSpanKeys,
}: {
  routeEntry: RouteEntry
  routeEntryPath: string
  minimumTraceWidthMm: number
  viaDimensions: ViaDimensions
  layerByName: ReadonlyMap<LayerName, CompiledLayerRule>
  legalViaSpanKeys: ReadonlySet<ViaSpanKey>
}): RouteEntry {
  if (routeEntry.route_type === "wire") {
    if (!layerByName.has(routeEntry.layer)) {
      failCompilation(
        "unknown_layer",
        `${routeEntryPath}.layer`,
        `references ${routeEntry.layer}`,
      )
    }
    const width = requirePositiveNumber(routeEntry.width, `${routeEntryPath}.width`)
    if (width < minimumTraceWidthMm) {
      failCompilation(
        "contradictory_rule",
        `${routeEntryPath}.width`,
        "preloaded copper must satisfy the minimum trace width",
      )
    }
    return Object.freeze({
      ...routeEntry,
      x: requireFiniteNumber(routeEntry.x, `${routeEntryPath}.x`),
      y: requireFiniteNumber(routeEntry.y, `${routeEntryPath}.y`),
      width,
    })
  }
  if (routeEntry.route_type === "via") {
    const spanKey = getViaSpanKey({
      fromLayer: routeEntry.from_layer,
      toLayer: routeEntry.to_layer,
      layerByName,
    })
    if (!legalViaSpanKeys.has(spanKey)) {
      failCompilation(
        "contradictory_rule",
        routeEntryPath,
        "preloaded via uses a span that is not legal",
      )
    }
    const viaDiameter =
      routeEntry.via_diameter ?? viaDimensions.viaPadDiameterMm
    const viaHoleDiameter =
      routeEntry.via_hole_diameter ?? viaDimensions.viaHoleDiameterMm
    if (
      viaDiameter < viaDimensions.viaPadDiameterMm ||
      viaHoleDiameter < viaDimensions.viaHoleDiameterMm ||
      viaDiameter <= viaHoleDiameter
    ) {
      failCompilation(
        "impossible_geometry",
        routeEntryPath,
        "preloaded via dimensions violate the compiled minimum annular geometry",
      )
    }
    return Object.freeze({
      ...routeEntry,
      x: requireFiniteNumber(routeEntry.x, `${routeEntryPath}.x`),
      y: requireFiniteNumber(routeEntry.y, `${routeEntryPath}.y`),
      via_diameter: viaDiameter,
      via_hole_diameter: viaHoleDiameter,
    })
  }
  if (routeEntry.route_type === "jumper") {
    failCompilation(
      "impossible_geometry",
      routeEntryPath,
      "preloaded jumpers do not encode exact copper pad dimensions required by the hybrid validator",
    )
  }
  if (
    !layerByName.has(routeEntry.from_layer) ||
    !layerByName.has(routeEntry.to_layer)
  ) {
    failCompilation(
      "unknown_layer",
      routeEntryPath,
      "through-obstacle copper references a layer outside the compiled stack",
    )
  }
  return Object.freeze({
    ...routeEntry,
    start: Object.freeze({
      x: requireFiniteNumber(routeEntry.start.x, `${routeEntryPath}.start.x`),
      y: requireFiniteNumber(routeEntry.start.y, `${routeEntryPath}.start.y`),
    }),
    end: Object.freeze({
      x: requireFiniteNumber(routeEntry.end.x, `${routeEntryPath}.end.x`),
      y: requireFiniteNumber(routeEntry.end.y, `${routeEntryPath}.end.y`),
    }),
    width: requirePositiveNumber(routeEntry.width, `${routeEntryPath}.width`),
    circuitJsonMetadata: routeEntry.circuitJsonMetadata
      ? Object.freeze({ ...routeEntry.circuitJsonMetadata })
      : undefined,
  })
}

function compilePreloadedCopper({
  simpleRouteJson,
  routingRules,
  connections,
  viaDimensions,
  layerByName,
  legalViaSpans,
}: {
  simpleRouteJson: SimpleRouteJson
  routingRules: HybridRoutingRulesInput
  connections: readonly CompiledConnectionRules[]
  viaDimensions: ViaDimensions
  layerByName: ReadonlyMap<LayerName, CompiledLayerRule>
  legalViaSpans: readonly CompiledLegalViaSpan[]
}): readonly CompiledPreloadedCopper[] {
  const traces = simpleRouteJson.traces ?? []
  const ownershipRules = routingRules.preloadedCopperOwnership ?? []
  const ownershipByTraceId = new Map<
    PcbTraceId,
    HybridPreloadedCopperOwnershipInput
  >()
  for (const [ownershipIndex, ownership] of ownershipRules.entries()) {
    if (ownershipByTraceId.has(ownership.pcbTraceId)) {
      failCompilation(
        "duplicate_identifier",
        `routingRules.preloadedCopperOwnership[${ownershipIndex}]`,
        `duplicates ${ownership.pcbTraceId}`,
      )
    }
    ownershipByTraceId.set(ownership.pcbTraceId, ownership)
  }
  const knownConnectionNames = new Set(
    connections.map((connection) => connection.connectionName),
  )
  const legalViaSpanKeys = new Set<ViaSpanKey>(
    legalViaSpans.map((span) =>
      getViaSpanKey({
        fromLayer: span.startLayer,
        toLayer: span.endLayer,
        layerByName,
      }),
    ),
  )
  const traceIds = new Set<PcbTraceId>()
  const preloadedCopper = traces.map((trace, traceIndex) => {
    const rulePath = `simpleRouteJson.traces[${traceIndex}]`
    if (traceIds.has(trace.pcb_trace_id)) {
      failCompilation(
        "duplicate_identifier",
        `${rulePath}.pcb_trace_id`,
        `duplicates ${trace.pcb_trace_id}`,
      )
    }
    traceIds.add(trace.pcb_trace_id)
    const ownership = ownershipByTraceId.get(trace.pcb_trace_id)
    if (!ownership) {
      failCompilation(
        "missing_rule",
        "routingRules.preloadedCopperOwnership",
        `has no ownership rule for ${trace.pcb_trace_id}`,
      )
    }
    const ownerConnectionNames =
      ownership.mutability === "mutable"
        ? freezeList(ownership.ownerConnectionNames)
        : freezeList<ConnectionName>([])
    if (ownership.mutability === "mutable" && ownerConnectionNames.length === 0) {
      failCompilation(
        "missing_rule",
        `routingRules.preloadedCopperOwnership.${trace.pcb_trace_id}`,
        "mutable copper must have at least one owner connection",
      )
    }
    for (const ownerConnectionName of ownerConnectionNames) {
      if (!knownConnectionNames.has(ownerConnectionName)) {
        failCompilation(
          "unknown_connection",
          `routingRules.preloadedCopperOwnership.${trace.pcb_trace_id}`,
          `references ${ownerConnectionName}`,
        )
      }
    }
    const normalizedTrace: SimplifiedPcbTrace = {
      ...trace,
      connectsTo: trace.connectsTo ? [...trace.connectsTo] : undefined,
      route: trace.route.map((routeEntry, routeEntryIndex) =>
        normalizePreloadedRouteEntry({
          routeEntry,
          routeEntryPath: `${rulePath}.route[${routeEntryIndex}]`,
          minimumTraceWidthMm: simpleRouteJson.minTraceWidth,
          viaDimensions,
          layerByName,
          legalViaSpanKeys,
        }),
      ),
    }
    Object.freeze(normalizedTrace.route)
    if (normalizedTrace.connectsTo) Object.freeze(normalizedTrace.connectsTo)
    return Object.freeze({
      trace: Object.freeze(normalizedTrace),
      mutability: ownership.mutability,
      ownerConnectionNames,
      hasSharedMutableOwnership:
        ownership.mutability === "mutable" && ownerConnectionNames.length > 1,
    })
  })
  for (const ownershipTraceId of ownershipByTraceId.keys()) {
    if (!traceIds.has(ownershipTraceId)) {
      failCompilation(
        "contradictory_rule",
        "routingRules.preloadedCopperOwnership",
        `references missing trace ${ownershipTraceId}`,
      )
    }
  }
  return freezeList(preloadedCopper)
}

export function compileRoutingRules({
  simpleRouteJson,
  routingRules,
}: {
  simpleRouteJson: SimpleRouteJson
  routingRules: HybridRoutingRulesInput
}): CompiledRoutingRules {
  const layerStack = compileLayerStack(simpleRouteJson.layerCount, routingRules)
  const layerByName = buildLayerByName(layerStack)
  const boardBounds = compileBoardBounds(simpleRouteJson)
  const viaDimensions = compileViaDimensions(simpleRouteJson)
  const legalViaSpans = compileLegalViaSpans({
    routingRules,
    layerStack,
    layerByName,
  })
  const connectionByName = buildConnectionByName(simpleRouteJson)
  const membership = buildMembership({ simpleRouteJson, connectionByName })
  const routeClasses = compileRouteClasses({
    simpleRouteJson,
    routingRules,
    layerStack,
    layerByName,
  })
  const assignmentByConnectionName = buildAssignmentByConnectionName({
    routingRules,
    connectionByName,
  })
  const powerRuleByConnectionName = buildPowerRuleByConnectionName({
    routingRules,
    connectionByName,
    membership,
  })
  const connections = compileConnections({
    simpleRouteJson,
    routingRules,
    routeClasses,
    assignmentByConnectionName,
    powerRuleByConnectionName,
    membership,
    layerStack,
    layerByName,
    viaPadDiameterMm: viaDimensions.viaPadDiameterMm,
  })
  const differentialPairs = compileDifferentialPairs({
    simpleRouteJson,
    connections,
    layerStack,
  })
  const buses = compileBuses({ simpleRouteJson, connections, layerStack })
  const preloadedCopper = compilePreloadedCopper({
    simpleRouteJson,
    routingRules,
    connections,
    viaDimensions,
    layerByName,
    legalViaSpans,
  })
  const obstacles = simpleRouteJson.obstacles.map((obstacle, obstacleIndex) =>
    validateObstacle(obstacle, obstacleIndex, layerByName),
  )
  return Object.freeze({
    layerStack,
    legalViaSpans,
    clearances: compileClearances(routingRules),
    routingResolutionMm: requirePositiveNumber(
      routingRules.routingResolutionMm,
      "routingRules.routingResolutionMm",
    ),
    viaHoleDiameterMm: viaDimensions.viaHoleDiameterMm,
    viaPadDiameterMm: viaDimensions.viaPadDiameterMm,
    allowViaInPad: simpleRouteJson.allowViaInPad ?? false,
    boardBounds,
    boardOutline: compileBoardOutline(simpleRouteJson, boardBounds),
    obstacles: freezeList(obstacles),
    connections,
    differentialPairs,
    buses,
    preloadedCopper,
  })
}
