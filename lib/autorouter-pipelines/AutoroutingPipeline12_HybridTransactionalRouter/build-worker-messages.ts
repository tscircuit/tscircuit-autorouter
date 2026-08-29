import type {
  DynamicRoutingRegion,
  GlobalRouteObjectPlan,
  HybridBoundaryContract,
} from "./planning-types"
import type {
  HybridCopperPrimitive,
  HybridCopperSnapshot,
  HybridTransactionDelta,
} from "./transactional-copper-types"
import type {
  CompiledConnectionRules,
  CompiledRoutingRules,
  TypedRoutingProblem,
} from "./types"
import type {
  HybridWorkerBoardContext,
  HybridWorkerCopperUpdate,
  HybridWorkerGeometry,
  RegionJob,
  RegionJobCoupling,
  RegionSearchSpec,
} from "./worker-protocol"
import { HYBRID_WORKER_PROTOCOL_VERSION } from "./worker-protocol"

export function buildHybridWorkerBoardContext({
  problem,
  copperSnapshot,
  contextId,
  boardContextVersion,
}: {
  problem: TypedRoutingProblem
  copperSnapshot: HybridCopperSnapshot
  contextId: string
  boardContextVersion: number
}): HybridWorkerBoardContext {
  const obstacleGeometry: HybridWorkerGeometry[] =
    problem.compiledRules.obstacles.flatMap((obstacle, obstacleIndex) =>
      obstacle.layers.map((layer) =>
        Object.freeze({
          geometry: Object.freeze({
            kind: "rotated_rect" as const,
            geometryId: `obstacle:${obstacle.obstacleId ?? obstacleIndex}:${layer}`,
            layer,
            centerX: obstacle.center.x,
            centerY: obstacle.center.y,
            widthMm: obstacle.width,
            heightMm: obstacle.height,
            rotationDegrees: obstacle.ccwRotationDegrees ?? 0,
          }),
          connectedConnectionNames: Object.freeze([...obstacle.connectedTo]),
        }),
      ),
    )
  const copperGeometry = [
    ...copperSnapshot.segments,
    ...copperSnapshot.vias,
  ].flatMap((primitive) =>
    convertPrimitiveToWorkerGeometry({
      primitive,
      compiledRules: problem.compiledRules,
    }),
  )
  return Object.freeze({
    protocolVersion: HYBRID_WORKER_PROTOCOL_VERSION,
    contextId,
    boardContextVersion,
    copperVersion: copperSnapshot.version,
    boardBounds: problem.compiledRules.boardBounds,
    layerNames: Object.freeze(
      problem.compiledRules.layerStack.map((layer) => layer.name),
    ),
    legalViaSpans: Object.freeze(
      problem.compiledRules.legalViaSpans.map((span) =>
        Object.freeze({
          fromLayer: span.startLayer,
          toLayer: span.endLayer,
        }),
      ),
    ),
    viaPadDiameterMm: problem.compiledRules.viaPadDiameterMm,
    viaHoleDiameterMm: problem.compiledRules.viaHoleDiameterMm,
    clearanceMm: Math.max(
      problem.compiledRules.clearances.traceToTraceMm,
      problem.compiledRules.clearances.traceToPadEdgeMm,
      problem.compiledRules.clearances.viaToTraceEdgeMm,
      problem.compiledRules.clearances.viaToPadEdgeMm,
    ),
    geometry: Object.freeze([...obstacleGeometry, ...copperGeometry]),
    connectionRules: Object.freeze(
      problem.compiledRules.connections.map((connection) =>
        Object.freeze({
          connectionName: connection.connectionName,
          traceWidthMm: connection.traceWidthMm,
          allowedLayers: connection.allowedLayers,
          viaSoftMaximum: connection.viaBudget.softMaximum,
          viaHardMaximum: connection.viaBudget.hardMaximum,
        }),
      ),
    ),
  })
}

export function buildRegionJob({
  problem,
  routePlan,
  region,
  boundaryContracts,
  copperSnapshot,
  maximumExpansions,
  maximumActivationRings,
  deterministicSeed,
}: {
  problem: TypedRoutingProblem
  routePlan: GlobalRouteObjectPlan
  region: DynamicRoutingRegion
  boundaryContracts: readonly HybridBoundaryContract[]
  copperSnapshot: HybridCopperSnapshot
  maximumExpansions: number
  maximumActivationRings: number
  deterministicSeed: number
}): RegionJob {
  const searches = routePlan.corridors.map(
    (corridor, corridorIndex): RegionSearchSpec => {
      const connection = getConnection({
        problem,
        connectionName: corridor.connectionName,
      })
      const startTerminal = getTerminalAtPoint({
        connection,
        point: corridor.start,
      })
      const endTerminal = getTerminalAtPoint({
        connection,
        point: corridor.end,
      })
      const preferredStartLayer = startTerminal.layers.includes(
        corridor.preferredLayer,
      )
        ? corridor.preferredLayer
        : startTerminal.layers[0]!
      const preferredEndLayer = endTerminal.layers.includes(
        corridor.preferredLayer,
      )
        ? corridor.preferredLayer
        : endTerminal.layers[0]!
      const existingViaCount = copperSnapshot.vias.filter(
        (via) => via.connectionName === connection.connectionName,
      ).length
      return Object.freeze({
        searchId: `${routePlan.routeObjectId}:search:${corridorIndex}`,
        connectionRuleReference: connection.connectionName,
        start: Object.freeze({
          x: startTerminal.x,
          y: startTerminal.y,
          layer: preferredStartLayer,
        }),
        goal: Object.freeze({
          x: endTerminal.x,
          y: endTerminal.y,
          layer: preferredEndLayer,
        }),
        connectedTerminalIds: Object.freeze([
          startTerminal.terminalId,
          endTerminal.terminalId,
        ]),
        remainingViaBudget: Math.max(
          0,
          connection.viaBudget.hardMaximum - existingViaCount,
        ),
      })
    },
  )
  const matchingContracts = boundaryContracts.filter(
    (contract) =>
      contract.firstRegionId === region.regionId ||
      contract.secondRegionId === region.regionId,
  )
  return Object.freeze({
    protocolVersion: HYBRID_WORKER_PROTOCOL_VERSION,
    jobId: `job:${region.regionId}:${routePlan.routeObjectId}`,
    regionId: region.regionId,
    transactionId: `transaction:${region.regionId}:${routePlan.routeObjectId}`,
    ownerRouteObjectId: routePlan.routeObjectId,
    boardContextVersion: 0,
    copperVersion: copperSnapshot.version,
    boundaryContractVersion: 0,
    bounds: region.bounds,
    envelope: region.maximumEnvelope,
    terminalReferences: Object.freeze([
      ...new Set(searches.flatMap((search) => search.connectedTerminalIds)),
    ]),
    boundaryContractReferences: Object.freeze(
      matchingContracts.map((contract) => contract.contractId).sort(),
    ),
    ownedPreloadedCopperReferences: region.ownedPreloadedCopperIds,
    searches: Object.freeze(searches),
    coupling: buildJobCoupling({ problem, routePlan }),
    solverBudget: Object.freeze({
      maximumExpansions,
      maximumActivationRings,
    }),
    routingResolutionMm: problem.compiledRules.routingResolutionMm,
    deterministicSeed:
      (deterministicSeed + stableStringHash(routePlan.routeObjectId)) >>> 0,
    congestionCost: routePlan.corridors.reduce(
      (total, corridor) => total + corridor.congestionPressure,
      0,
    ),
    diagnostic: Object.freeze({
      code: "worker_region_candidate",
      message: "worker generated a regional transaction candidate",
      regionIds: Object.freeze([region.regionId]),
      connectionNames: routePlan.connectionNames,
    }),
  })
}

function buildJobCoupling({
  problem,
  routePlan,
}: {
  problem: TypedRoutingProblem
  routePlan: GlobalRouteObjectPlan
}): RegionJobCoupling {
  const routeObject = problem.routeObjects.find(
    (candidate) => candidate.routeObjectId === routePlan.routeObjectId,
  )
  if (!routeObject) {
    throw new Error(`unknown route object ${routePlan.routeObjectId}`)
  }
  if (routeObject.kind === "differential_pair") {
    return Object.freeze({
      kind: "differential_pair" as const,
      orderedConnectionNames: routeObject.rules.connectionNames,
      adjacentEdgeGapsMm: Object.freeze([
        routeObject.rules.spacingMm,
      ]) as readonly [number],
      maximumSkewMm: routeObject.rules.maximumSkewMm,
      maximumUncoupledLengthMm:
        routeObject.rules.maximumUncoupledLengthMm,
    })
  }
  if (routeObject.kind === "bus") {
    return Object.freeze({
      kind: "bus" as const,
      busId: routeObject.rules.busId,
      orderedConnectionNames: routeObject.rules.orderedConnectionNames,
      adjacentEdgeGapsMm: Object.freeze(
        routeObject.rules.orderedConnectionNames.slice(0, -1).map(
          (connectionName, connectionIndex) =>
            problem.compiledRules.differentialPairs.find(
              (pair) =>
                pair.connectionNames.includes(connectionName) &&
                pair.connectionNames.includes(
                  routeObject.rules.orderedConnectionNames[connectionIndex + 1]!,
                ),
            )?.spacingMm ??
            problem.compiledRules.clearances.traceToTraceMm,
        ),
      ),
      maximumSkewMm: routeObject.rules.maximumSkewMm,
    })
  }
  if (routeObject.kind === "power") {
    return Object.freeze({
      kind: "power" as const,
      connectionName: routeObject.connection.connectionName,
      topology: routeObject.connection.topology,
    })
  }
  return Object.freeze({ kind: "independent" as const })
}

export function buildWorkerCopperUpdate({
  problem,
  delta,
  nextCopperVersion,
}: {
  problem: TypedRoutingProblem
  delta: HybridTransactionDelta
  nextCopperVersion: number
}): HybridWorkerCopperUpdate {
  return Object.freeze({
    baseCopperVersion: nextCopperVersion - 1,
    nextCopperVersion,
    removedGeometryIds: Object.freeze([
      ...delta.removedOwnedTraceIds,
      ...delta.removedOwnedViaIds.flatMap((viaId) =>
        problem.compiledRules.layerStack.map((layer) => `${viaId}:${layer.name}`),
      ),
    ]),
    addedGeometry: Object.freeze(
      [...delta.addedTraces, ...delta.addedVias].flatMap((primitive) =>
        convertPrimitiveToWorkerGeometry({
          primitive,
          compiledRules: problem.compiledRules,
        }),
      ),
    ),
  })
}

function convertPrimitiveToWorkerGeometry({
  primitive,
  compiledRules,
}: {
  primitive: HybridCopperPrimitive
  compiledRules: CompiledRoutingRules
}): readonly HybridWorkerGeometry[] {
  if (primitive.kind === "segment") {
    return [
      Object.freeze({
        geometry: Object.freeze({
          kind: "segment" as const,
          geometryId: primitive.copperId,
          layer: primitive.layer,
          startX: primitive.start.x,
          startY: primitive.start.y,
          endX: primitive.end.x,
          endY: primitive.end.y,
          widthMm: primitive.widthMm,
        }),
        connectedConnectionNames: Object.freeze([primitive.connectionName]),
      }),
    ]
  }
  const startIndex = compiledRules.layerStack.findIndex(
    (layer) => layer.name === primitive.fromLayer,
  )
  const endIndex = compiledRules.layerStack.findIndex(
    (layer) => layer.name === primitive.toLayer,
  )
  return compiledRules.layerStack
    .slice(Math.min(startIndex, endIndex), Math.max(startIndex, endIndex) + 1)
    .map((layer) =>
      Object.freeze({
        geometry: Object.freeze({
          kind: "circle" as const,
          geometryId: `${primitive.copperId}:${layer.name}`,
          layer: layer.name,
          centerX: primitive.x,
          centerY: primitive.y,
          radiusMm: primitive.padDiameterMm / 2,
        }),
        connectedConnectionNames: Object.freeze([primitive.connectionName]),
      }),
    )
}

function getConnection({
  problem,
  connectionName,
}: {
  problem: TypedRoutingProblem
  connectionName: string
}): CompiledConnectionRules {
  const connection = problem.compiledRules.connections.find(
    (candidate) => candidate.connectionName === connectionName,
  )
  if (!connection) throw new Error(`unknown connection ${connectionName}`)
  return connection
}

function getTerminalAtPoint({
  connection,
  point,
}: {
  connection: CompiledConnectionRules
  point: { readonly x: number; readonly y: number }
}): CompiledConnectionRules["terminals"][number] {
  const terminal = connection.terminals.find(
    (candidate) => candidate.x === point.x && candidate.y === point.y,
  )
  if (!terminal) {
    throw new Error(
      `corridor endpoint does not resolve to ${connection.connectionName} terminal`,
    )
  }
  return terminal
}

function stableStringHash(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}
