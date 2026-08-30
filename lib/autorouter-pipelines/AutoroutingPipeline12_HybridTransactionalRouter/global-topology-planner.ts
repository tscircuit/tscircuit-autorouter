import {
  findCoupledRouteConstraintViolation,
  isConnectionFullyConnected,
} from "./coupled-route-constraints"
import { buildInitialCopperSnapshot } from "./transactional-copper-store"
import type {
  CompiledConnectionRules,
  CompiledRoutingRules,
  LayerName,
  TypedRouteObject,
  TypedRoutingProblem,
} from "./types"
import type {
  GlobalRouteObjectPlan,
  GlobalTopologyPlan,
  HybridTopologyKind,
  PlannedRoutingCorridor,
} from "./planning-types"

export function planGlobalTopology({
  problem,
  maximumEstimatedMemoryBytesPerObject,
}: {
  problem: TypedRoutingProblem
  maximumEstimatedMemoryBytesPerObject: number
}): GlobalTopologyPlan {
  if (
    !Number.isSafeInteger(maximumEstimatedMemoryBytesPerObject) ||
    maximumEstimatedMemoryBytesPerObject <= 0
  ) {
    throw new Error(
      "maximumEstimatedMemoryBytesPerObject must be a positive safe integer",
    )
  }
  const initialCopperSnapshot = buildInitialCopperSnapshot({ problem })
  const routeObjectPlans = problem.routeObjects
    .filter((routeObject) => routeObject.kind !== "preloaded_copper")
    .filter(
      (routeObject) =>
        !isRouteObjectSatisfiedByPreloadedCopper({
          routeObject,
          compiledRules: problem.compiledRules,
          initialCopperSnapshot,
        }),
    )
    .map((routeObject) =>
      planRouteObject({
        routeObject,
        compiledRules: problem.compiledRules,
        maximumEstimatedMemoryBytesPerObject,
      }),
    )
    .sort((first, second) =>
      first.routeObjectId.localeCompare(second.routeObjectId),
    )
  return Object.freeze({
    planVersion: 0,
    routeObjectPlans: freezeList(routeObjectPlans),
  })
}

function isRouteObjectSatisfiedByPreloadedCopper({
  routeObject,
  compiledRules,
  initialCopperSnapshot,
}: {
  routeObject: TypedRouteObject
  compiledRules: CompiledRoutingRules
  initialCopperSnapshot: ReturnType<typeof buildInitialCopperSnapshot>
}): boolean {
  const connections = getRouteObjectConnections(routeObject)
  if (
    connections.length === 0 ||
    connections.some(
      (connection) =>
        !isConnectionFullyConnected({
          compiledRules,
          copperSnapshot: initialCopperSnapshot,
          connection,
        }),
    )
  ) {
    return false
  }
  return !findCoupledRouteConstraintViolation({
    compiledRules,
    copperSnapshot: initialCopperSnapshot,
    affectedConnectionNames: new Set(
      connections.map((connection) => connection.connectionName),
    ),
  })
}

function planRouteObject({
  routeObject,
  compiledRules,
  maximumEstimatedMemoryBytesPerObject,
}: {
  routeObject: TypedRouteObject
  compiledRules: CompiledRoutingRules
  maximumEstimatedMemoryBytesPerObject: number
}): GlobalRouteObjectPlan {
  const connections = getRouteObjectConnections(routeObject)
  const coupledEnvelopeReserveMm = getCoupledEnvelopeReserve({
    routeObject,
    compiledRules,
  })
  const corridors = connections.flatMap((connection) =>
    planConnectionCorridors({
      connection,
      routeObject,
      compiledRules,
      coupledEnvelopeReserveMm,
    }),
  )
  if (
    routeObject.kind === "power" &&
    routeObject.connection.topology === "mesh"
  ) {
    corridors.push(
      ...planPowerMeshClosure({
        connection: routeObject.connection,
        routeObject,
        compiledRules,
        coupledEnvelopeReserveMm,
        existingCorridors: corridors,
      }),
    )
  }
  const preferredLayers = freezeList(
    compiledRules.layerStack
      .map((layer) => layer.name)
      .filter((layer) =>
        corridors.some((corridor) => corridor.preferredLayer === layer),
      ),
  )
  const estimatedSolverWork = corridors.reduce(
    (total, corridor) =>
      total +
      Math.ceil(corridor.estimatedLengthMm / compiledRules.routingResolutionMm) *
        (1 + corridor.congestionPressure + corridor.approximateLayerTransitions),
    0,
  )
  const estimatedMemoryBytes = Math.min(
    maximumEstimatedMemoryBytesPerObject,
    Math.ceil(estimatedSolverWork * 56 + corridors.length * 512),
  )
  return Object.freeze({
    routeObjectId: routeObject.routeObjectId,
    routeObjectKind: routeObject.kind,
    topology: getTopology(routeObject),
    connectionNames: freezeList(
      connections.map((connection) => connection.connectionName),
    ),
    preferredLayers,
    corridors: freezeList(corridors),
    coupledEnvelopeReserveMm,
    estimatedSolverWork,
    estimatedMemoryBytes,
    criticality: getCriticality(routeObject),
  })
}

function planPowerMeshClosure({
  connection,
  routeObject,
  compiledRules,
  coupledEnvelopeReserveMm,
  existingCorridors,
}: {
  connection: Extract<CompiledConnectionRules, { kind: "power" }>
  routeObject: TypedRouteObject
  compiledRules: CompiledRoutingRules
  coupledEnvelopeReserveMm: number
  existingCorridors: readonly PlannedRoutingCorridor[]
}): readonly PlannedRoutingCorridor[] {
  const terminalPairs = connection.terminals.flatMap((first, firstIndex) =>
    connection.terminals.slice(firstIndex + 1).map((second) => ({
      first,
      second,
      distance: Math.hypot(second.x - first.x, second.y - first.y),
    })),
  )
  const closure = terminalPairs
    .filter(
      ({ first, second }) =>
        !existingCorridors.some(
          (corridor) =>
            (samePoint(corridor.start, first) &&
              samePoint(corridor.end, second)) ||
            (samePoint(corridor.start, second) &&
              samePoint(corridor.end, first)),
        ),
    )
    .sort(
      (first, second) =>
        first.distance - second.distance ||
        first.first.terminalId.localeCompare(second.first.terminalId) ||
        first.second.terminalId.localeCompare(second.second.terminalId),
    )[0]
  if (!closure) {
    throw new Error(
      `power mesh ${connection.connectionName} has no independent closure edge`,
    )
  }
  const closureConnection: typeof connection = Object.freeze({
    ...connection,
    terminals: Object.freeze([closure.first, closure.second]),
  })
  return planConnectionCorridors({
    connection: closureConnection,
    routeObject,
    compiledRules,
    coupledEnvelopeReserveMm,
  }).map((corridor) =>
    Object.freeze({
      ...corridor,
      corridorId: `${routeObject.routeObjectId}:${connection.connectionName}:${existingCorridors.length}`,
    }),
  )
}

function getRouteObjectConnections(
  routeObject: TypedRouteObject,
): readonly CompiledConnectionRules[] {
  if (routeObject.kind === "signal" || routeObject.kind === "power") {
    return [routeObject.connection]
  }
  if (routeObject.kind === "differential_pair") {
    return routeObject.members.map((member) => member.connection)
  }
  if (routeObject.kind === "bus") {
    return routeObject.members.flatMap((member) =>
      member.kind === "signal"
        ? [member.connection]
        : member.members.map((pairMember) => pairMember.connection),
    )
  }
  return []
}

function planConnectionCorridors({
  connection,
  routeObject,
  compiledRules,
  coupledEnvelopeReserveMm,
}: {
  connection: CompiledConnectionRules
  routeObject: TypedRouteObject
  compiledRules: CompiledRoutingRules
  coupledEnvelopeReserveMm: number
}): readonly PlannedRoutingCorridor[] {
  const terminals = [...connection.terminals].sort((first, second) =>
    first.terminalId.localeCompare(second.terminalId),
  )
  const remainingTerminals = terminals.slice(1)
  const connectedTerminals = terminals.slice(0, 1)
  const corridors: PlannedRoutingCorridor[] = []
  while (remainingTerminals.length > 0) {
    const candidates = connectedTerminals.flatMap((start) =>
      remainingTerminals.map((end) => ({
        start,
        end,
        distance: Math.hypot(end.x - start.x, end.y - start.y),
      })),
    )
    candidates.sort(
      (first, second) =>
        first.distance - second.distance ||
        first.start.terminalId.localeCompare(second.start.terminalId) ||
        first.end.terminalId.localeCompare(second.end.terminalId),
    )
    const selected = candidates[0]!
    const preferredLayer = selectPreferredLayer({
      connection,
      start: selected.start,
      end: selected.end,
      compiledRules,
    })
    const widthReserveMm =
      connection.traceWidthMm / 2 +
      compiledRules.clearances.traceToTraceMm +
      coupledEnvelopeReserveMm
    const bounds = Object.freeze({
      minX: Math.min(selected.start.x, selected.end.x) - widthReserveMm,
      maxX: Math.max(selected.start.x, selected.end.x) + widthReserveMm,
      minY: Math.min(selected.start.y, selected.end.y) - widthReserveMm,
      maxY: Math.max(selected.start.y, selected.end.y) + widthReserveMm,
    })
    const obstaclePressure = compiledRules.obstacles.filter((obstacle) => {
      const obstacleBounds = {
        minX: obstacle.center.x - obstacle.width / 2,
        maxX: obstacle.center.x + obstacle.width / 2,
        minY: obstacle.center.y - obstacle.height / 2,
        maxY: obstacle.center.y + obstacle.height / 2,
      }
      return boundsOverlap({ first: bounds, second: obstacleBounds })
    }).length
    const immutableCopperPressure = compiledRules.preloadedCopper.filter(
      (copper) =>
        copper.mutability === "immutable" &&
        copper.trace.route.some((entry) => {
          if (entry.route_type !== "wire" && entry.route_type !== "via") {
            return false
          }
          return (
            entry.x >= bounds.minX &&
            entry.x <= bounds.maxX &&
            entry.y >= bounds.minY &&
            entry.y <= bounds.maxY
          )
        }),
    ).length
    corridors.push(
      Object.freeze({
        corridorId: `${routeObject.routeObjectId}:${connection.connectionName}:${corridors.length}`,
        connectionName: connection.connectionName,
        start: Object.freeze({ x: selected.start.x, y: selected.start.y }),
        end: Object.freeze({ x: selected.end.x, y: selected.end.y }),
        preferredLayer,
        widthReserveMm,
        estimatedLengthMm: selected.distance,
        congestionPressure: obstaclePressure,
        immutableCopperPressure,
        approximateLayerTransitions:
          Number(!selected.start.layers.includes(preferredLayer)) +
          Number(!selected.end.layers.includes(preferredLayer)),
        bounds,
      }),
    )
    connectedTerminals.push(selected.end)
    remainingTerminals.splice(remainingTerminals.indexOf(selected.end), 1)
  }
  return corridors
}

function selectPreferredLayer({
  connection,
  start,
  end,
  compiledRules,
}: {
  connection: CompiledConnectionRules
  start: CompiledConnectionRules["terminals"][number]
  end: CompiledConnectionRules["terminals"][number]
  compiledRules: CompiledRoutingRules
}): LayerName {
  const isHorizontal = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y)
  const rankedLayers = compiledRules.layerStack
    .filter((layer) => connection.allowedLayers.includes(layer.name))
    .map((layer) => ({
      layer,
      terminalPenalty:
        Number(!start.layers.includes(layer.name)) +
        Number(!end.layers.includes(layer.name)),
      directionPenalty:
        layer.preferredDirection === "any" ||
        layer.preferredDirection === (isHorizontal ? "horizontal" : "vertical")
          ? 0
          : 1,
    }))
    .sort(
      (first, second) =>
        first.terminalPenalty - second.terminalPenalty ||
        first.directionPenalty - second.directionPenalty ||
        first.layer.zIndex - second.layer.zIndex ||
        first.layer.name.localeCompare(second.layer.name),
    )
  const selectedLayer = rankedLayers[0]?.layer.name
  if (!selectedLayer) {
    throw new Error(
      `connection ${connection.connectionName} has no routable preferred layer`,
    )
  }
  return selectedLayer
}

function getTopology(routeObject: TypedRouteObject): HybridTopologyKind {
  if (routeObject.kind === "differential_pair" || routeObject.kind === "bus") {
    return "coupled_parallel"
  }
  if (routeObject.kind === "power") {
    return routeObject.connection.topology === "point_to_point"
      ? "direct"
      : routeObject.connection.topology
  }
  if (routeObject.kind === "signal") {
    return routeObject.connection.terminals.length === 2 ? "direct" : "tree"
  }
  return "direct"
}

function getCriticality(routeObject: TypedRouteObject): number {
  if (routeObject.kind === "differential_pair") return 5
  if (routeObject.kind === "bus") return 4
  if (routeObject.kind === "power") return 3
  if (routeObject.kind === "signal") return 2
  return 1
}

function getCoupledEnvelopeReserve({
  routeObject,
  compiledRules,
}: {
  routeObject: TypedRouteObject
  compiledRules: CompiledRoutingRules
}): number {
  if (routeObject.kind === "differential_pair") {
    return (
      routeObject.rules.spacingMm +
      Math.max(...routeObject.members.map((member) => member.connection.traceWidthMm))
    )
  }
  if (routeObject.kind === "bus") {
    return (
      routeObject.members.length *
      (compiledRules.clearances.traceToTraceMm +
        Math.max(
          ...getRouteObjectConnections(routeObject).map(
            (connection) => connection.traceWidthMm,
          ),
        ))
    )
  }
  return 0
}

function boundsOverlap({
  first,
  second,
}: {
  first: { minX: number; maxX: number; minY: number; maxY: number }
  second: { minX: number; maxX: number; minY: number; maxY: number }
}): boolean {
  return !(
    first.maxX < second.minX ||
    first.minX > second.maxX ||
    first.maxY < second.minY ||
    first.minY > second.maxY
  )
}

function samePoint(
  first: { readonly x: number; readonly y: number },
  second: { readonly x: number; readonly y: number },
): boolean {
  return first.x === second.x && first.y === second.y
}

function freezeList<Item>(items: readonly Item[]): readonly Item[] {
  return Object.freeze([...items])
}
