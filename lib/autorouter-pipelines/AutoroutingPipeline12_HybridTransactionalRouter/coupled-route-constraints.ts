import { pointToPrimitiveEdgeDistance, primitiveEdgeDistance } from "./exact-geometry"
import type {
  CompiledConnectionRules,
  CompiledRoutingRules,
  LayerName,
} from "./types"
import type {
  HybridCopperId,
  HybridCopperPrimitive,
  HybridCopperSegment,
  HybridCopperSnapshot,
} from "./transactional-copper-types"

const GEOMETRY_EPSILON = 1e-9

export type CoupledRouteConstraintViolation = {
  readonly code:
    | "differential_pair_constraint_violation"
    | "bus_constraint_violation"
    | "power_constraint_violation"
  readonly message: string
  readonly connectionNames: readonly string[]
  readonly conflictingCopperIds: readonly HybridCopperId[]
}

export function findCoupledRouteConstraintViolation({
  compiledRules,
  copperSnapshot,
  affectedConnectionNames,
}: {
  compiledRules: CompiledRoutingRules
  copperSnapshot: HybridCopperSnapshot
  affectedConnectionNames: ReadonlySet<string>
}): CoupledRouteConstraintViolation | undefined {
  for (const pair of compiledRules.differentialPairs) {
    if (
      !pair.connectionNames.some((connectionName) =>
        affectedConnectionNames.has(connectionName),
      )
    ) {
      continue
    }
    const connectivityViolation = findConnectivityViolation({
      compiledRules,
      copperSnapshot,
      connectionNames: pair.connectionNames,
      code: "differential_pair_constraint_violation",
    })
    if (connectivityViolation) return connectivityViolation
    const [firstName, secondName] = pair.connectionNames
    const firstSegments = copperSnapshot.segments.filter(
      (segment) => segment.connectionName === firstName,
    )
    const secondSegments = copperSnapshot.segments.filter(
      (segment) => segment.connectionName === secondName,
    )
    const firstLength = getRoutedLength(firstSegments)
    const secondLength = getRoutedLength(secondSegments)
    if (Math.abs(firstLength - secondLength) > pair.maximumSkewMm + GEOMETRY_EPSILON) {
      return violation({
        code: "differential_pair_constraint_violation",
        message: `${firstName}/${secondName} skew ${Math.abs(firstLength - secondLength)}mm exceeds ${pair.maximumSkewMm}mm`,
        connectionNames: pair.connectionNames,
        primitives: [...firstSegments, ...secondSegments],
      })
    }
    const spacingToleranceMm = compiledRules.routingResolutionMm / 2
    const firstUncoupledLength = getUncoupledLength({
      subjectSegments: firstSegments,
      partnerSegments: secondSegments,
      edgeGapMm: pair.spacingMm,
      spacingToleranceMm,
    })
    const secondUncoupledLength = getUncoupledLength({
      subjectSegments: secondSegments,
      partnerSegments: firstSegments,
      edgeGapMm: pair.spacingMm,
      spacingToleranceMm,
    })
    const maximumMeasuredUncoupledLength = Math.max(
      firstUncoupledLength,
      secondUncoupledLength,
    )
    if (
      maximumMeasuredUncoupledLength >
      pair.maximumUncoupledLengthMm + GEOMETRY_EPSILON
    ) {
      return violation({
        code: "differential_pair_constraint_violation",
        message: `${firstName}/${secondName} has ${maximumMeasuredUncoupledLength}mm uncoupled; ${pair.maximumUncoupledLengthMm}mm is permitted`,
        connectionNames: pair.connectionNames,
        primitives: [...firstSegments, ...secondSegments],
      })
    }
    const firstVias = copperSnapshot.vias.filter(
      (via) => via.connectionName === firstName,
    )
    const secondVias = copperSnapshot.vias.filter(
      (via) => via.connectionName === secondName,
    )
    if (
      firstVias.length !== secondVias.length ||
      firstVias.some(
        (via) =>
          !secondVias.some(
            (partner) =>
              sameViaSpan(via, partner) &&
              Math.abs(
                primitiveEdgeDistance({ first: via, second: partner }) -
                  pair.spacingMm,
              ) <= spacingToleranceMm + GEOMETRY_EPSILON,
          ),
      )
    ) {
      return violation({
        code: "differential_pair_constraint_violation",
        message: `${firstName}/${secondName} has unmatched or incorrectly spaced pair vias`,
        connectionNames: pair.connectionNames,
        primitives: [...firstVias, ...secondVias],
      })
    }
  }
  for (const bus of compiledRules.buses) {
    if (
      !bus.orderedConnectionNames.some((connectionName) =>
        affectedConnectionNames.has(connectionName),
      )
    ) {
      continue
    }
    const connectivityViolation = findConnectivityViolation({
      compiledRules,
      copperSnapshot,
      connectionNames: bus.orderedConnectionNames,
      code: "bus_constraint_violation",
    })
    if (connectivityViolation) return connectivityViolation
    const lengths = bus.orderedConnectionNames.map((connectionName) =>
      getRoutedLength(
        copperSnapshot.segments.filter(
          (segment) => segment.connectionName === connectionName,
        ),
      ),
    )
    const lengthSkew = Math.max(...lengths) - Math.min(...lengths)
    if (lengthSkew > bus.maximumSkewMm + GEOMETRY_EPSILON) {
      return violation({
        code: "bus_constraint_violation",
        message: `bus ${bus.busId} skew ${lengthSkew}mm exceeds ${bus.maximumSkewMm}mm`,
        connectionNames: bus.orderedConnectionNames,
        primitives: getPrimitivesForConnections({
          copperSnapshot,
          connectionNames: bus.orderedConnectionNames,
        }),
      })
    }
    if (
      !hasStableBusOrdering({
        busConnectionNames: bus.orderedConnectionNames,
        compiledRules,
        copperSnapshot,
      })
    ) {
      return violation({
        code: "bus_constraint_violation",
        message: `bus ${bus.busId} does not preserve its compiled member order`,
        connectionNames: bus.orderedConnectionNames,
        primitives: getPrimitivesForConnections({
          copperSnapshot,
          connectionNames: bus.orderedConnectionNames,
        }),
      })
    }
  }
  for (const connection of compiledRules.connections) {
    if (
      connection.kind !== "power" ||
      !affectedConnectionNames.has(connection.connectionName)
    ) {
      continue
    }
    if (!isConnectionFullyConnected({ compiledRules, copperSnapshot, connection })) {
      return violation({
        code: "power_constraint_violation",
        message: `power connection ${connection.connectionName} does not connect every terminal`,
        connectionNames: [connection.connectionName],
        primitives: getPrimitivesForConnections({
          copperSnapshot,
          connectionNames: [connection.connectionName],
        }),
      })
    }
    const hasCycle = powerConnectionHasCycle({
      compiledRules,
      copperSnapshot,
      connectionName: connection.connectionName,
    })
    if (connection.topology === "mesh" ? !hasCycle : hasCycle) {
      return violation({
        code: "power_constraint_violation",
        message:
          connection.topology === "mesh"
            ? `power mesh ${connection.connectionName} has no redundant copper cycle`
            : `power ${connection.topology} ${connection.connectionName} contains a copper cycle`,
        connectionNames: [connection.connectionName],
        primitives: getPrimitivesForConnections({
          copperSnapshot,
          connectionNames: [connection.connectionName],
        }),
      })
    }
  }
  return undefined
}

function findConnectivityViolation({
  compiledRules,
  copperSnapshot,
  connectionNames,
  code,
}: {
  compiledRules: CompiledRoutingRules
  copperSnapshot: HybridCopperSnapshot
  connectionNames: readonly string[]
  code: CoupledRouteConstraintViolation["code"]
}): CoupledRouteConstraintViolation | undefined {
  for (const connectionName of connectionNames) {
    const connection = compiledRules.connections.find(
      (candidate) => candidate.connectionName === connectionName,
    )
    if (
      !connection ||
      !isConnectionFullyConnected({ compiledRules, copperSnapshot, connection })
    ) {
      return violation({
        code,
        message: `${connectionName} does not physically connect every declared terminal`,
        connectionNames: [connectionName],
        primitives: getPrimitivesForConnections({
          copperSnapshot,
          connectionNames: [connectionName],
        }),
      })
    }
  }
  return undefined
}

export function isConnectionFullyConnected({
  compiledRules,
  copperSnapshot,
  connection,
}: {
  compiledRules: CompiledRoutingRules
  copperSnapshot: HybridCopperSnapshot
  connection: CompiledConnectionRules
}): boolean {
  const primitives = getPrimitivesForConnections({
    copperSnapshot,
    connectionNames: [connection.connectionName],
  })
  if (primitives.length === 0) return false
  const parent = primitives.map((_, primitiveIndex) => primitiveIndex)
  for (let firstIndex = 0; firstIndex < primitives.length; firstIndex++) {
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < primitives.length;
      secondIndex++
    ) {
      const first = primitives[firstIndex]!
      const second = primitives[secondIndex]!
      if (
        primitivesShareLayer({ first, second, compiledRules }) &&
        primitiveEdgeDistance({ first, second }) <= GEOMETRY_EPSILON
      ) {
        union(parent, firstIndex, secondIndex)
      }
    }
  }
  let terminalRoot: number | undefined
  for (const terminal of connection.terminals) {
    const touchingPrimitiveIndex = primitives.findIndex((primitive) =>
      terminal.layers.some(
        (layer) =>
          pointToPrimitiveEdgeDistance({
            point: terminal,
            layer,
            primitive,
            viaLayers: getPrimitiveLayers({ primitive, compiledRules }),
          }) <= GEOMETRY_EPSILON,
      ),
    )
    if (touchingPrimitiveIndex < 0) return false
    const root = find(parent, touchingPrimitiveIndex)
    if (terminalRoot === undefined) terminalRoot = root
    else if (terminalRoot !== root) return false
  }
  return true
}

function getUncoupledLength({
  subjectSegments,
  partnerSegments,
  edgeGapMm,
  spacingToleranceMm,
}: {
  subjectSegments: readonly HybridCopperSegment[]
  partnerSegments: readonly HybridCopperSegment[]
  edgeGapMm: number
  spacingToleranceMm: number
}): number {
  return subjectSegments.reduce((uncoupledLength, segment) => {
    const segmentLength = getSegmentLength(segment)
    const intervals = partnerSegments.flatMap((partner) => {
      const interval = getCoupledInterval({
        subject: segment,
        partner,
        edgeGapMm,
        spacingToleranceMm,
      })
      return interval ? [interval] : []
    })
    return uncoupledLength + segmentLength - getIntervalUnionLength(intervals)
  }, 0)
}

function getCoupledInterval({
  subject,
  partner,
  edgeGapMm,
  spacingToleranceMm,
}: {
  subject: HybridCopperSegment
  partner: HybridCopperSegment
  edgeGapMm: number
  spacingToleranceMm: number
}): readonly [number, number] | undefined {
  if (subject.layer !== partner.layer) return undefined
  const direction = {
    x: subject.end.x - subject.start.x,
    y: subject.end.y - subject.start.y,
  }
  const partnerDirection = {
    x: partner.end.x - partner.start.x,
    y: partner.end.y - partner.start.y,
  }
  const length = Math.hypot(direction.x, direction.y)
  const partnerLength = Math.hypot(partnerDirection.x, partnerDirection.y)
  if (length <= GEOMETRY_EPSILON || partnerLength <= GEOMETRY_EPSILON) {
    return undefined
  }
  if (
    Math.abs(cross(direction, partnerDirection)) >
    GEOMETRY_EPSILON * length * partnerLength
  ) {
    return undefined
  }
  const delta = {
    x: partner.start.x - subject.start.x,
    y: partner.start.y - subject.start.y,
  }
  const centerlineDistance = Math.abs(cross(direction, delta)) / length
  const measuredEdgeGap =
    centerlineDistance - subject.widthMm / 2 - partner.widthMm / 2
  if (
    Math.abs(measuredEdgeGap - edgeGapMm) >
    spacingToleranceMm + GEOMETRY_EPSILON
  ) {
    return undefined
  }
  const unit = { x: direction.x / length, y: direction.y / length }
  const firstProjection = dot(delta, unit)
  const secondProjection = dot(
    {
      x: partner.end.x - subject.start.x,
      y: partner.end.y - subject.start.y,
    },
    unit,
  )
  const intervalStart = Math.max(0, Math.min(firstProjection, secondProjection))
  const intervalEnd = Math.min(length, Math.max(firstProjection, secondProjection))
  return intervalEnd > intervalStart + GEOMETRY_EPSILON
    ? [intervalStart, intervalEnd]
    : undefined
}

function getIntervalUnionLength(
  intervals: readonly (readonly [number, number])[],
): number {
  const ordered = [...intervals].sort(
    (first, second) => first[0] - second[0] || first[1] - second[1],
  )
  let total = 0
  let activeStart: number | undefined
  let activeEnd: number | undefined
  for (const [start, end] of ordered) {
    if (activeStart === undefined || activeEnd === undefined) {
      activeStart = start
      activeEnd = end
      continue
    }
    if (start <= activeEnd + GEOMETRY_EPSILON) {
      activeEnd = Math.max(activeEnd, end)
      continue
    }
    total += activeEnd - activeStart
    activeStart = start
    activeEnd = end
  }
  return activeStart === undefined || activeEnd === undefined
    ? total
    : total + activeEnd - activeStart
}

function hasStableBusOrdering({
  busConnectionNames,
  compiledRules,
  copperSnapshot,
}: {
  busConnectionNames: readonly string[]
  compiledRules: CompiledRoutingRules
  copperSnapshot: HybridCopperSnapshot
}): boolean {
  const connections = busConnectionNames.map((connectionName) =>
    compiledRules.connections.find(
      (candidate) => candidate.connectionName === connectionName,
    ),
  )
  if (connections.some((connection) => !connection)) return false
  const firstTerminal = connections[0]!.terminals[0]!
  const lastTerminal = connections[connections.length - 1]!.terminals[0]!
  let orderAxis = {
    x: lastTerminal.x - firstTerminal.x,
    y: lastTerminal.y - firstTerminal.y,
  }
  if (Math.hypot(orderAxis.x, orderAxis.y) <= GEOMETRY_EPSILON) {
    const firstEnd = connections[0]!.terminals.at(-1)!
    const lastEnd = connections[connections.length - 1]!.terminals.at(-1)!
    orderAxis = { x: lastEnd.x - firstEnd.x, y: lastEnd.y - firstEnd.y }
  }
  const axisLength = Math.hypot(orderAxis.x, orderAxis.y)
  if (axisLength <= GEOMETRY_EPSILON) return false
  const unitAxis = { x: orderAxis.x / axisLength, y: orderAxis.y / axisLength }
  const projections = busConnectionNames.map((connectionName) => {
    const segments = copperSnapshot.segments.filter(
      (segment) => segment.connectionName === connectionName,
    )
    const totalLength = getRoutedLength(segments)
    if (totalLength <= GEOMETRY_EPSILON) return Number.NaN
    return (
      segments.reduce((weightedProjection, segment) => {
        const midpoint = {
          x: (segment.start.x + segment.end.x) / 2,
          y: (segment.start.y + segment.end.y) / 2,
        }
        return (
          weightedProjection +
          dot(midpoint, unitAxis) * getSegmentLength(segment)
        )
      }, 0) / totalLength
    )
  })
  return projections.every(
    (projection, projectionIndex) =>
      Number.isFinite(projection) &&
      (projectionIndex === 0 ||
        projection > projections[projectionIndex - 1]! + GEOMETRY_EPSILON),
  )
}

function powerConnectionHasCycle({
  compiledRules,
  copperSnapshot,
  connectionName,
}: {
  compiledRules: CompiledRoutingRules
  copperSnapshot: HybridCopperSnapshot
  connectionName: string
}): boolean {
  const parent = new Map<string, string>()
  const connect = (first: string, second: string): boolean => {
    const firstRoot = findKey(parent, first)
    const secondRoot = findKey(parent, second)
    if (firstRoot === secondRoot) return true
    parent.set(secondRoot, firstRoot)
    return false
  }
  for (const segment of copperSnapshot.segments.filter(
    (candidate) => candidate.connectionName === connectionName,
  )) {
    if (
      connect(
        pointLayerKey(segment.start, segment.layer),
        pointLayerKey(segment.end, segment.layer),
      )
    ) {
      return true
    }
  }
  for (const via of copperSnapshot.vias.filter(
    (candidate) => candidate.connectionName === connectionName,
  )) {
    const layers = getPrimitiveLayers({ primitive: via, compiledRules })
    for (let layerIndex = 0; layerIndex < layers.length - 1; layerIndex++) {
      if (
        connect(
          pointLayerKey(via, layers[layerIndex]!),
          pointLayerKey(via, layers[layerIndex + 1]!),
        )
      ) {
        return true
      }
    }
  }
  return false
}

function findKey(parent: Map<string, string>, key: string): string {
  const currentParent = parent.get(key)
  if (!currentParent) {
    parent.set(key, key)
    return key
  }
  if (currentParent === key) return key
  const root = findKey(parent, currentParent)
  parent.set(key, root)
  return root
}

function pointLayerKey(
  point: { readonly x: number; readonly y: number },
  layer: string,
): string {
  return `${layer}:${point.x.toPrecision(15)}:${point.y.toPrecision(15)}`
}

function primitivesShareLayer({
  first,
  second,
  compiledRules,
}: {
  first: HybridCopperPrimitive
  second: HybridCopperPrimitive
  compiledRules: CompiledRoutingRules
}): boolean {
  const firstLayers = getPrimitiveLayers({ primitive: first, compiledRules })
  const secondLayers = getPrimitiveLayers({ primitive: second, compiledRules })
  return firstLayers.some((layer) => secondLayers.includes(layer))
}

function getPrimitiveLayers({
  primitive,
  compiledRules,
}: {
  primitive: HybridCopperPrimitive
  compiledRules: CompiledRoutingRules
}): readonly LayerName[] {
  if (primitive.kind === "segment") return [primitive.layer]
  const startIndex = compiledRules.layerStack.findIndex(
    (layer) => layer.name === primitive.fromLayer,
  )
  const endIndex = compiledRules.layerStack.findIndex(
    (layer) => layer.name === primitive.toLayer,
  )
  return compiledRules.layerStack
    .slice(Math.min(startIndex, endIndex), Math.max(startIndex, endIndex) + 1)
    .map((layer) => layer.name)
}

function sameViaSpan(
  first: Extract<HybridCopperPrimitive, { kind: "via" }>,
  second: Extract<HybridCopperPrimitive, { kind: "via" }>,
): boolean {
  return (
    (first.fromLayer === second.fromLayer && first.toLayer === second.toLayer) ||
    (first.fromLayer === second.toLayer && first.toLayer === second.fromLayer)
  )
}

function getPrimitivesForConnections({
  copperSnapshot,
  connectionNames,
}: {
  copperSnapshot: HybridCopperSnapshot
  connectionNames: readonly string[]
}): readonly HybridCopperPrimitive[] {
  return [
    ...copperSnapshot.segments.filter((segment) =>
      connectionNames.includes(segment.connectionName),
    ),
    ...copperSnapshot.vias.filter((via) =>
      connectionNames.includes(via.connectionName),
    ),
  ]
}

function getRoutedLength(segments: readonly HybridCopperSegment[]): number {
  return segments.reduce(
    (total, segment) => total + getSegmentLength(segment),
    0,
  )
}

function getSegmentLength(segment: HybridCopperSegment): number {
  return Math.hypot(
    segment.end.x - segment.start.x,
    segment.end.y - segment.start.y,
  )
}

function find(parent: number[], item: number): number {
  if (parent[item] !== item) parent[item] = find(parent, parent[item]!)
  return parent[item]!
}

function union(parent: number[], first: number, second: number): void {
  const firstRoot = find(parent, first)
  const secondRoot = find(parent, second)
  if (firstRoot !== secondRoot) parent[secondRoot] = firstRoot
}

function dot(
  first: { readonly x: number; readonly y: number },
  second: { readonly x: number; readonly y: number },
): number {
  return first.x * second.x + first.y * second.y
}

function cross(
  first: { readonly x: number; readonly y: number },
  second: { readonly x: number; readonly y: number },
): number {
  return first.x * second.y - first.y * second.x
}

function violation({
  code,
  message,
  connectionNames,
  primitives,
}: {
  code: CoupledRouteConstraintViolation["code"]
  message: string
  connectionNames: readonly string[]
  primitives: readonly HybridCopperPrimitive[]
}): CoupledRouteConstraintViolation {
  return Object.freeze({
    code,
    message,
    connectionNames: Object.freeze([...connectionNames]),
    conflictingCopperIds: Object.freeze(
      primitives.map((primitive) => primitive.copperId),
    ),
  })
}
