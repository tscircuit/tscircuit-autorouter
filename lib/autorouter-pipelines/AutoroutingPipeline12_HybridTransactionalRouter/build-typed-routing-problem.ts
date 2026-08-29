import type {
  BusMemberRouteObject,
  BusRouteObject,
  CompiledBusRules,
  CompiledConnectionRules,
  CompiledDifferentialPairRules,
  CompiledPowerConnectionRules,
  CompiledPreloadedCopper,
  CompiledRoutingRules,
  CompiledSignalConnectionRules,
  ConnectionName,
  DifferentialPairRouteObject,
  HybridRoutingEnvelope,
  HybridValidationRequirement,
  LayerName,
  PowerRouteObject,
  PreloadedCopperRouteObject,
  RouteObjectId,
  RouteObjectOwnershipRecord,
  RouteOwnership,
  SignalRouteObject,
  TypedRouteObject,
  TypedRoutingProblem,
} from "./types"

export class HybridRoutingProblemBuildError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "HybridRoutingProblemBuildError"
  }
}

function freezeList<Item>(items: readonly Item[]): readonly Item[] {
  const copiedItems = [...items]
  for (const item of copiedItems) {
    if (typeof item === "object" && item !== null) Object.freeze(item)
  }
  return Object.freeze(copiedItems)
}

function createRoutingEnvelope({
  compiledRules,
  allowedLayers,
}: {
  compiledRules: CompiledRoutingRules
  allowedLayers: readonly LayerName[]
}): HybridRoutingEnvelope {
  return Object.freeze({
    bounds: compiledRules.boardBounds,
    allowedLayers,
  })
}

function createOwnership({
  ownerRouteObjectId,
  connectionNames,
  delegated,
}: {
  ownerRouteObjectId: RouteObjectId
  connectionNames: readonly ConnectionName[]
  delegated: boolean
}): RouteOwnership {
  return Object.freeze({
    kind: delegated ? ("delegated" as const) : ("direct" as const),
    ownerRouteObjectId,
    connectionNames: freezeList(connectionNames),
  })
}

function createSignalRouteObject({
  compiledRules,
  connection,
  routeObjectId,
  ownerRouteObjectId,
}: {
  compiledRules: CompiledRoutingRules
  connection: CompiledSignalConnectionRules
  routeObjectId: RouteObjectId
  ownerRouteObjectId: RouteObjectId
}): SignalRouteObject {
  const validationRequirements: readonly HybridValidationRequirement[] =
    freezeList([
      "terminal_connectivity",
      "no_unintended_connectivity",
      "exact_clearance",
      "legal_via_spans",
      "via_budget",
      "board_outline",
    ])
  return Object.freeze({
    kind: "signal",
    routeObjectId,
    ownership: createOwnership({
      ownerRouteObjectId,
      connectionNames: [connection.connectionName],
      delegated: routeObjectId !== ownerRouteObjectId,
    }),
    tuningEnvelope: createRoutingEnvelope({
      compiledRules,
      allowedLayers: connection.allowedLayers,
    }),
    validationRequirements,
    connection,
  })
}

function createDifferentialPairRouteObject({
  compiledRules,
  pairRules,
  connectionByName,
  routeObjectId,
  ownerRouteObjectId,
}: {
  compiledRules: CompiledRoutingRules
  pairRules: CompiledDifferentialPairRules
  connectionByName: ReadonlyMap<ConnectionName, CompiledConnectionRules>
  routeObjectId: RouteObjectId
  ownerRouteObjectId: RouteObjectId
}): DifferentialPairRouteObject {
  const [firstConnectionName, secondConnectionName] = pairRules.connectionNames
  const firstConnection = connectionByName.get(firstConnectionName)
  const secondConnection = connectionByName.get(secondConnectionName)
  if (
    firstConnection?.kind !== "signal" ||
    secondConnection?.kind !== "signal"
  ) {
    throw new HybridRoutingProblemBuildError(
      `Differential pair ${firstConnectionName}/${secondConnectionName} does not resolve to two signal rules`,
    )
  }
  const members = Object.freeze([
    createSignalRouteObject({
      compiledRules,
      connection: firstConnection,
      routeObjectId: `${routeObjectId}:member:${firstConnectionName}`,
      ownerRouteObjectId,
    }),
    createSignalRouteObject({
      compiledRules,
      connection: secondConnection,
      routeObjectId: `${routeObjectId}:member:${secondConnectionName}`,
      ownerRouteObjectId,
    }),
  ]) as readonly [SignalRouteObject, SignalRouteObject]
  const validationRequirements: readonly HybridValidationRequirement[] =
    freezeList([
      "terminal_connectivity",
      "no_unintended_connectivity",
      "exact_clearance",
      "legal_via_spans",
      "via_budget",
      "board_outline",
      "differential_pair_spacing",
      "differential_pair_skew",
      "maximum_uncoupled_pair_length",
    ])
  return Object.freeze({
    kind: "differential_pair",
    routeObjectId,
    ownership: createOwnership({
      ownerRouteObjectId,
      connectionNames: pairRules.connectionNames,
      delegated: routeObjectId !== ownerRouteObjectId,
    }),
    tuningEnvelope: createRoutingEnvelope({
      compiledRules,
      allowedLayers: pairRules.allowedLayers,
    }),
    validationRequirements,
    rules: pairRules,
    members,
  })
}

function createBusRouteObject({
  compiledRules,
  busRules,
  connectionByName,
  pairByConnectionName,
}: {
  compiledRules: CompiledRoutingRules
  busRules: CompiledBusRules
  connectionByName: ReadonlyMap<ConnectionName, CompiledConnectionRules>
  pairByConnectionName: ReadonlyMap<
    ConnectionName,
    CompiledDifferentialPairRules
  >
}): BusRouteObject {
  const routeObjectId = `bus:${busRules.busId}`
  const consumedConnectionNames = new Set<ConnectionName>()
  const members: BusMemberRouteObject[] = []
  for (const connectionName of busRules.orderedConnectionNames) {
    if (consumedConnectionNames.has(connectionName)) continue
    const pairRules = pairByConnectionName.get(connectionName)
    if (pairRules) {
      for (const pairConnectionName of pairRules.connectionNames) {
        consumedConnectionNames.add(pairConnectionName)
      }
      members.push(
        createDifferentialPairRouteObject({
          compiledRules,
          pairRules,
          connectionByName,
          routeObjectId: `${routeObjectId}:pair:${pairRules.connectionNames.join(":")}`,
          ownerRouteObjectId: routeObjectId,
        }),
      )
      continue
    }
    const connection = connectionByName.get(connectionName)
    if (connection?.kind !== "signal") {
      throw new HybridRoutingProblemBuildError(
        `Bus ${busRules.busId} member ${connectionName} is not a signal connection`,
      )
    }
    consumedConnectionNames.add(connectionName)
    members.push(
      createSignalRouteObject({
        compiledRules,
        connection,
        routeObjectId: `${routeObjectId}:member:${connectionName}`,
        ownerRouteObjectId: routeObjectId,
      }),
    )
  }
  const validationRequirements: readonly HybridValidationRequirement[] =
    freezeList([
      "terminal_connectivity",
      "no_unintended_connectivity",
      "exact_clearance",
      "legal_via_spans",
      "via_budget",
      "board_outline",
      "bus_ordering",
      "bus_skew",
    ])
  return Object.freeze({
    kind: "bus",
    routeObjectId,
    ownership: createOwnership({
      ownerRouteObjectId: routeObjectId,
      connectionNames: busRules.orderedConnectionNames,
      delegated: false,
    }),
    tuningEnvelope: createRoutingEnvelope({
      compiledRules,
      allowedLayers: busRules.allowedLayers,
    }),
    validationRequirements,
    rules: busRules,
    members: freezeList(members),
  })
}

function createPowerRouteObject({
  compiledRules,
  connection,
}: {
  compiledRules: CompiledRoutingRules
  connection: CompiledPowerConnectionRules
}): PowerRouteObject {
  const routeObjectId = `power:${connection.connectionName}`
  const validationRequirements: readonly HybridValidationRequirement[] =
    freezeList([
      "terminal_connectivity",
      "no_unintended_connectivity",
      "exact_clearance",
      "legal_via_spans",
      "via_budget",
      "board_outline",
      "power_topology",
    ])
  return Object.freeze({
    kind: "power",
    routeObjectId,
    ownership: createOwnership({
      ownerRouteObjectId: routeObjectId,
      connectionNames: [connection.connectionName],
      delegated: false,
    }),
    tuningEnvelope: createRoutingEnvelope({
      compiledRules,
      allowedLayers: connection.allowedLayers,
    }),
    validationRequirements,
    connection,
  })
}

function getPreloadedCopperLayers({
  copper,
  compiledRules,
}: {
  copper: CompiledPreloadedCopper
  compiledRules: CompiledRoutingRules
}): readonly LayerName[] {
  const usedLayerNames = new Set<LayerName>()
  for (const routeEntry of copper.trace.route) {
    if (routeEntry.route_type === "wire" || routeEntry.route_type === "jumper") {
      usedLayerNames.add(routeEntry.layer)
      continue
    }
    usedLayerNames.add(routeEntry.from_layer)
    usedLayerNames.add(routeEntry.to_layer)
  }
  return freezeList(
    compiledRules.layerStack
      .filter((layer) => usedLayerNames.has(layer.name))
      .map((layer) => layer.name),
  )
}

function createPreloadedCopperRouteObject({
  compiledRules,
  copper,
}: {
  compiledRules: CompiledRoutingRules
  copper: CompiledPreloadedCopper
}): PreloadedCopperRouteObject {
  const routeObjectId = `preloaded:${copper.trace.pcb_trace_id}`
  const validationRequirements: readonly HybridValidationRequirement[] =
    freezeList([
      "no_unintended_connectivity",
      "exact_clearance",
      "legal_via_spans",
      "board_outline",
      "preloaded_copper_continuity",
    ])
  return Object.freeze({
    kind: "preloaded_copper",
    routeObjectId,
    ownership: createOwnership({
      ownerRouteObjectId: routeObjectId,
      connectionNames: copper.ownerConnectionNames,
      delegated: false,
    }),
    tuningEnvelope: createRoutingEnvelope({
      compiledRules,
      allowedLayers: getPreloadedCopperLayers({ copper, compiledRules }),
    }),
    validationRequirements,
    copper,
  })
}

function recordConnectionOwnership({
  ownerByConnectionName,
  connectionNames,
  ownerRouteObjectId,
}: {
  ownerByConnectionName: Map<ConnectionName, RouteObjectId>
  connectionNames: readonly ConnectionName[]
  ownerRouteObjectId: RouteObjectId
}): void {
  for (const connectionName of connectionNames) {
    const existingOwner = ownerByConnectionName.get(connectionName)
    if (existingOwner) {
      throw new HybridRoutingProblemBuildError(
        `${connectionName} is owned by both ${existingOwner} and ${ownerRouteObjectId}`,
      )
    }
    ownerByConnectionName.set(connectionName, ownerRouteObjectId)
  }
}

export function buildTypedRoutingProblem(
  compiledRules: CompiledRoutingRules,
): TypedRoutingProblem {
  const connectionByName = new Map<ConnectionName, CompiledConnectionRules>(
    compiledRules.connections.map((connection) => [
      connection.connectionName,
      connection,
    ]),
  )
  const pairByConnectionName = new Map<
    ConnectionName,
    CompiledDifferentialPairRules
  >()
  for (const pairRules of compiledRules.differentialPairs) {
    for (const connectionName of pairRules.connectionNames) {
      pairByConnectionName.set(connectionName, pairRules)
    }
  }
  const busConnectionNames = new Set(
    compiledRules.buses.flatMap((bus) => bus.orderedConnectionNames),
  )
  const ownerByConnectionName = new Map<ConnectionName, RouteObjectId>()
  const routeObjects: TypedRouteObject[] = []
  for (const busRules of compiledRules.buses) {
    const busRouteObject = createBusRouteObject({
      compiledRules,
      busRules,
      connectionByName,
      pairByConnectionName,
    })
    routeObjects.push(busRouteObject)
    recordConnectionOwnership({
      ownerByConnectionName,
      connectionNames: busRules.orderedConnectionNames,
      ownerRouteObjectId: busRouteObject.routeObjectId,
    })
  }
  const emittedPairFirstNames = new Set<ConnectionName>()
  for (const pairRules of compiledRules.differentialPairs) {
    const [firstConnectionName] = pairRules.connectionNames
    if (busConnectionNames.has(firstConnectionName)) continue
    if (emittedPairFirstNames.has(firstConnectionName)) continue
    emittedPairFirstNames.add(firstConnectionName)
    const routeObjectId = `differential_pair:${pairRules.connectionNames.join(":")}`
    const pairRouteObject = createDifferentialPairRouteObject({
      compiledRules,
      pairRules,
      connectionByName,
      routeObjectId,
      ownerRouteObjectId: routeObjectId,
    })
    routeObjects.push(pairRouteObject)
    recordConnectionOwnership({
      ownerByConnectionName,
      connectionNames: pairRules.connectionNames,
      ownerRouteObjectId: routeObjectId,
    })
  }
  for (const connection of compiledRules.connections) {
    if (ownerByConnectionName.has(connection.connectionName)) continue
    const routeObject =
      connection.kind === "power"
        ? createPowerRouteObject({ compiledRules, connection })
        : createSignalRouteObject({
            compiledRules,
            connection,
            routeObjectId: `signal:${connection.connectionName}`,
            ownerRouteObjectId: `signal:${connection.connectionName}`,
          })
    routeObjects.push(routeObject)
    recordConnectionOwnership({
      ownerByConnectionName,
      connectionNames: [connection.connectionName],
      ownerRouteObjectId: routeObject.routeObjectId,
    })
  }
  for (const copper of compiledRules.preloadedCopper) {
    routeObjects.push(createPreloadedCopperRouteObject({ compiledRules, copper }))
  }
  if (ownerByConnectionName.size !== compiledRules.connections.length) {
    throw new HybridRoutingProblemBuildError(
      "Every compiled connection must have exactly one authoritative route owner",
    )
  }
  const ownershipByConnection: RouteObjectOwnershipRecord[] =
    compiledRules.connections.map((connection) =>
      Object.freeze({
        connectionName: connection.connectionName,
        ownerRouteObjectId: ownerByConnectionName.get(
          connection.connectionName,
        )!,
      }),
    )
  return Object.freeze({
    compiledRules,
    routeObjects: freezeList(routeObjects),
    ownershipByConnection: freezeList(ownershipByConnection),
  })
}
