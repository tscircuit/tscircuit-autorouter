import { negotiateBoundaryContracts } from "./boundary-contract-negotiator"
import { DemandCapacityField } from "./demand-capacity-field"
import { createDeterministicRegionSchedule } from "./deterministic-region-scheduler"
import { DynamicRegionGraph } from "./dynamic-region-graph"
import { planGlobalTopology } from "./global-topology-planner"
import { runMultiResolutionSearch } from "./multi-resolution-router"
import { HYBRID_ROUTING_CORE_PROTOCOL_VERSION } from "./rust-core-protocol"
import type {
  HybridCoreGeometry,
  HybridCoreRoutePoint,
  HybridCoreSearchRequest,
  HybridCoreSearchResponse,
  HybridRoutingCoreRuntime,
} from "./rust-core-protocol"
import type {
  SerialHybridEngineArtifacts,
  SerialHybridEngineResult,
} from "./serial-engine-types"
import { TransactionalCopperStore } from "./transactional-copper-store"
import type {
  HybridCopperOwnership,
  HybridCopperPrimitive,
  HybridCopperSegment,
  HybridCopperSnapshot,
  HybridCopperVia,
  HybridTransactionDelta,
} from "./transactional-copper-types"
import type {
  CompiledConnectionRules,
  CompiledRoutingRules,
  TypedRoutingProblem,
} from "./types"
import type {
  DynamicRoutingRegion,
  GlobalRouteObjectPlan,
  RegionAttemptRecord,
} from "./planning-types"

export type SerialHybridEngineConfiguration = {
  readonly runtime: HybridRoutingCoreRuntime
  readonly deterministicSeed: number
  readonly maximumSearchExpansions: number
  readonly maximumActivationRings: number
  readonly maximumTransactionHistory: number
  readonly maximumDemandCellCount: number
  readonly maximumRegionCount: number
  readonly maximumRegionMutationCount: number
  readonly maximumMergeRegionCount: number
  readonly maximumEstimatedMemoryBytesPerObject: number
  readonly maximumWaveMemoryBytes: number
}

export async function runSerialHybridTransactionalEngine({
  problem,
  configuration,
}: {
  problem: TypedRoutingProblem
  configuration: SerialHybridEngineConfiguration
}): Promise<SerialHybridEngineResult> {
  validateConfiguration(configuration)
  const topologyPlan = planGlobalTopology({
    problem,
    maximumEstimatedMemoryBytesPerObject:
      configuration.maximumEstimatedMemoryBytesPerObject,
  })
  const copperStore = new TransactionalCopperStore({
    problem,
    maximumTransactionHistory: configuration.maximumTransactionHistory,
  })
  const demandField = new DemandCapacityField({
    problem,
    topologyPlan,
    copperSnapshot: copperStore.getSnapshot(),
    maximumCellCount: configuration.maximumDemandCellCount,
  })
  const dynamicRegionGraph = new DynamicRegionGraph({
    problem,
    topologyPlan,
    maximumRegionCount: configuration.maximumRegionCount,
    maximumMutationCount: configuration.maximumRegionMutationCount,
    maximumMergeRegionCount: configuration.maximumMergeRegionCount,
  })
  const regionGraph = dynamicRegionGraph.getSnapshot()
  const boundaryContracts = negotiateBoundaryContracts({
    problem,
    topologyPlan,
    regionGraph,
  })
  copperStore.setBoundaryContractVersion(regionGraph.graphVersion)
  const schedule = createDeterministicRegionSchedule({
    regionGraph,
    maximumConcurrency: 1,
    maximumWaveMemoryBytes: configuration.maximumWaveMemoryBytes,
  })
  const attempts: RegionAttemptRecord[] = []
  const scheduledRegionIds = schedule.flatMap((wave) =>
    wave.regions.map((scheduled) => scheduled.regionId),
  )
  for (const [scheduledIndex, regionId] of scheduledRegionIds.entries()) {
    const region = regionGraph.regions.find(
      (candidate) => candidate.regionId === regionId,
    )
    if (!region) {
      return createFailedResult({
        topologyPlan,
        demandField,
        regionGraph,
        boundaryContracts,
        copperStore,
        attempts,
        message: `schedule references missing region ${regionId}`,
      })
    }
    for (const routeObjectId of region.routeObjectIds) {
      const routePlan = topologyPlan.routeObjectPlans.find(
        (candidate) => candidate.routeObjectId === routeObjectId,
      )
      if (!routePlan) {
        return createFailedResult({
          topologyPlan,
          demandField,
          regionGraph,
          boundaryContracts,
          copperStore,
          attempts,
          failedRegionId: regionId,
          message: `region references missing route plan ${routeObjectId}`,
        })
      }
      const attemptStart = performance.now()
      let candidate: RegionCandidateResult
      try {
        candidate = await routeRegionPlan({
          problem,
          routePlan,
          region,
          copperSnapshot: copperStore.getSnapshot(),
          configuration,
        })
      } catch (error) {
        attempts.push(
          createAttempt({
            region,
            routePlan,
            attemptIndex: attempts.length,
            solveTimeMs: performance.now() - attemptStart,
            outcome: "failed",
            rejectionReason: getErrorMessage(error),
          }),
        )
        return createFailedResult({
          topologyPlan,
          demandField,
          regionGraph,
          boundaryContracts,
          copperStore,
          attempts,
          failedRegionId: regionId,
          message: getErrorMessage(error),
        })
      }
      if (candidate.status === "failed") {
        attempts.push(
          createAttempt({
            region,
            routePlan,
            attemptIndex: attempts.length,
            solveTimeMs: performance.now() - attemptStart,
            outcome: "failed",
            rejectionReason: candidate.message,
          }),
        )
        return createIncompleteResult({
          topologyPlan,
          demandField,
          regionGraph,
          boundaryContracts,
          copperStore,
          attempts,
          failedRegionId: regionId,
          unresolvedRegionIds: scheduledRegionIds.slice(scheduledIndex),
          message: candidate.message,
        })
      }
      const commit = copperStore.commit(candidate.delta)
      if (commit.status !== "committed") {
        attempts.push(
          createAttempt({
            region,
            routePlan,
            attemptIndex: attempts.length,
            solveTimeMs: performance.now() - attemptStart,
            outcome: "rejected",
            rejectionReason: commit.rejection.message,
            transactionId: candidate.delta.transactionId,
          }),
        )
        return createIncompleteResult({
          topologyPlan,
          demandField,
          regionGraph,
          boundaryContracts,
          copperStore,
          attempts,
          failedRegionId: regionId,
          unresolvedRegionIds: scheduledRegionIds.slice(scheduledIndex),
          rejection: commit.rejection,
          message: commit.rejection.message,
        })
      }
      demandField.applyCommittedTransaction({
        delta: candidate.delta,
        committedSnapshot: commit.snapshot,
      })
      attempts.push(
        createAttempt({
          region,
          routePlan,
          attemptIndex: attempts.length,
          solveTimeMs: performance.now() - attemptStart,
          outcome: "committed",
          transactionId: candidate.delta.transactionId,
        }),
      )
    }
  }
  return Object.freeze({
    status: "routed",
    artifacts: createArtifacts({
      topologyPlan,
      demandField,
      regionGraph,
      boundaryContracts,
      copperStore,
      attempts,
    }),
  })
}

type RegionCandidateResult =
  | { readonly status: "candidate"; readonly delta: HybridTransactionDelta }
  | { readonly status: "failed"; readonly message: string }

async function routeRegionPlan({
  problem,
  routePlan,
  region,
  copperSnapshot,
  configuration,
}: {
  problem: TypedRoutingProblem
  routePlan: GlobalRouteObjectPlan
  region: DynamicRoutingRegion
  copperSnapshot: HybridCopperSnapshot
  configuration: SerialHybridEngineConfiguration
}): Promise<RegionCandidateResult> {
  const addedTraces: HybridCopperSegment[] = []
  const addedVias: HybridCopperVia[] = []
  let searchExpansions = 0
  let spatialIndexQueries = 0
  let drcPredicateCalls = 0
  let bendCount = 0
  let candidatesConstructed = 0
  let candidatesStepped = 0
  let activeRings = 0
  let solverStateRebuilds = 0
  for (const [corridorIndex, corridor] of routePlan.corridors.entries()) {
    const connection = getConnection({
      problem,
      connectionName: corridor.connectionName,
    })
    const search = await runMultiResolutionSearch({
      runtime: configuration.runtime,
      baseRequest: createCoreRequest({
        problem,
        connection,
        routePlan,
        corridorIndex,
        region,
        copperSnapshot,
        configuration,
      }),
      maximumActivationRings: configuration.maximumActivationRings,
    })
    searchExpansions += search.metrics.work.searchExpansions
    spatialIndexQueries += search.metrics.work.spatialIndexQueries
    drcPredicateCalls += search.metrics.work.geometryPredicateCalls
    candidatesConstructed += search.metrics.candidatesConstructed
    candidatesStepped += search.metrics.candidatesStepped
    activeRings += search.metrics.activeRings
    solverStateRebuilds += search.metrics.solverStateRebuilds
    if (search.status === "failed") {
      return {
        status: "failed",
        message: `${search.response.code}: ${search.response.message}`,
      }
    }
    const response = search.response
    const ownership = createCandidateOwnership(routePlan.routeObjectId)
    addedTraces.push(
      ...convertCoreRouteToSegments({
        response,
        connection,
        routePlan,
        corridorIndex,
        ownership,
      }),
    )
    addedVias.push(
      ...convertCoreRouteToVias({
        response,
        connection,
        routePlan,
        corridorIndex,
        ownership,
        compiledRules: problem.compiledRules,
      }),
    )
    bendCount += response.cost.bendCount
  }
  const totalLengthMm = addedTraces.reduce(
    (total, segment) =>
      total +
      Math.hypot(
        segment.end.x - segment.start.x,
        segment.end.y - segment.start.y,
      ),
    0,
  )
  const softViaBudgetExceeded = routePlan.connectionNames.some(
    (connectionName) => {
      const connection = getConnection({ problem, connectionName })
      return (
        addedVias.filter((via) => via.connectionName === connectionName).length >
        connection.viaBudget.softMaximum
      )
    },
  )
  const delta: HybridTransactionDelta = Object.freeze({
    transactionId: `transaction:${region.regionId}:${routePlan.routeObjectId}:${copperSnapshot.version}`,
    regionId: region.regionId,
    ownerRouteObjectId: routePlan.routeObjectId,
    baseCopperVersion: copperSnapshot.version,
    boundaryContractVersion: 0,
    addedTraces: Object.freeze(addedTraces),
    removedOwnedTraceIds: Object.freeze([]),
    addedVias: Object.freeze(addedVias),
    removedOwnedViaIds: Object.freeze([]),
    connectivityEffects: Object.freeze({
      connectionNames: routePlan.connectionNames,
      connectedTerminalIds: Object.freeze(
        routePlan.connectionNames.flatMap((connectionName) =>
          getConnection({ problem, connectionName }).terminals.map(
            (terminal) => terminal.terminalId,
          ),
        ),
      ),
    }),
    affectedBounds: region.maximumEnvelope,
    candidateCost: Object.freeze({
      viaCount: addedVias.length,
      totalLengthMm,
      bendCount,
      congestionCost: routePlan.corridors.reduce(
        (total, corridor) => total + corridor.congestionPressure,
        0,
      ),
      softViaBudgetExceeded,
      softViaBudgetJustification: softViaBudgetExceeded
        ? "the deterministic legal path required terminal or corridor layer transitions"
        : undefined,
    }),
    work: Object.freeze({
      searchExpansions,
      spatialIndexQueries,
      drcPredicateCalls,
      geometryAllocations: addedTraces.length + addedVias.length,
      candidatesConstructed,
      candidatesStepped,
      activeRings,
      solverStateRebuilds,
    }),
    diagnostic: Object.freeze({
      code: "region_candidate_complete",
      message: "Rust core produced a complete region candidate",
      regionIds: Object.freeze([region.regionId]),
      connectionNames: routePlan.connectionNames,
    }),
  })
  return { status: "candidate", delta }
}

function createCoreRequest({
  problem,
  connection,
  routePlan,
  corridorIndex,
  region,
  copperSnapshot,
  configuration,
}: {
  problem: TypedRoutingProblem
  connection: CompiledConnectionRules
  routePlan: GlobalRouteObjectPlan
  corridorIndex: number
  region: DynamicRoutingRegion
  copperSnapshot: HybridCopperSnapshot
  configuration: SerialHybridEngineConfiguration
}): HybridCoreSearchRequest {
  const corridor = routePlan.corridors[corridorIndex]!
  const startTerminal = findTerminalAtPoint({
    connection,
    point: corridor.start,
  })
  const endTerminal = findTerminalAtPoint({
    connection,
    point: corridor.end,
  })
  const startLayer = startTerminal.layers.includes(corridor.preferredLayer)
    ? corridor.preferredLayer
    : startTerminal.layers[0]!
  const endLayer = endTerminal.layers.includes(corridor.preferredLayer)
    ? corridor.preferredLayer
    : endTerminal.layers[0]!
  const existingViaCount = copperSnapshot.vias.filter(
    (via) => via.connectionName === connection.connectionName,
  ).length
  return Object.freeze({
    protocolVersion: HYBRID_ROUTING_CORE_PROTOCOL_VERSION,
    regionId: `${region.regionId}:${routePlan.routeObjectId}:${corridorIndex}`,
    bounds: region.maximumEnvelope,
    activeBounds: region.maximumEnvelope,
    activationBounds: Object.freeze([]),
    layerNames: connection.allowedLayers,
    start: Object.freeze({
      x: startTerminal.x,
      y: startTerminal.y,
      layer: startLayer,
    }),
    goal: Object.freeze({
      x: endTerminal.x,
      y: endTerminal.y,
      layer: endLayer,
    }),
    legalViaSpans: Object.freeze(
      problem.compiledRules.legalViaSpans
        .filter(
          (span) =>
            connection.allowedLayers.includes(span.startLayer) &&
            connection.allowedLayers.includes(span.endLayer),
        )
        .map((span) =>
          Object.freeze({
            fromLayer: span.startLayer,
            toLayer: span.endLayer,
          }),
        ),
    ),
    obstacles: buildCoreGeometry({
      problem,
      connection,
      copperSnapshot,
    }),
    resolutionMm: problem.compiledRules.routingResolutionMm,
    traceWidthMm: connection.traceWidthMm,
    clearanceMm: Math.max(
      problem.compiledRules.clearances.traceToTraceMm,
      problem.compiledRules.clearances.traceToPadEdgeMm,
      problem.compiledRules.clearances.viaToTraceEdgeMm,
      problem.compiledRules.clearances.viaToPadEdgeMm,
    ),
    viaPadDiameterMm: problem.compiledRules.viaPadDiameterMm,
    maximumVias: Math.max(
      0,
      connection.viaBudget.hardMaximum - existingViaCount,
    ),
    maximumExpansions: configuration.maximumSearchExpansions,
    deterministicSeed:
      (configuration.deterministicSeed +
        stableStringHash(corridor.corridorId)) >>>
      0,
  })
}

function buildCoreGeometry({
  problem,
  connection,
  copperSnapshot,
}: {
  problem: TypedRoutingProblem
  connection: CompiledConnectionRules
  copperSnapshot: HybridCopperSnapshot
}): readonly HybridCoreGeometry[] {
  const obstacleGeometry: HybridCoreGeometry[] = problem.compiledRules.obstacles
    .filter((obstacle) => !obstacle.connectedTo.includes(connection.connectionName))
    .flatMap((obstacle, obstacleIndex) =>
      obstacle.layers
        .filter((layer) => connection.allowedLayers.includes(layer))
        .map((layer) => ({
          kind: "rotated_rect" as const,
          geometryId: `obstacle:${obstacle.obstacleId ?? obstacleIndex}:${layer}`,
          layer,
          centerX: obstacle.center.x,
          centerY: obstacle.center.y,
          widthMm: obstacle.width,
          heightMm: obstacle.height,
          rotationDegrees: obstacle.ccwRotationDegrees ?? 0,
        })),
    )
  const copperGeometry = [
    ...copperSnapshot.segments,
    ...copperSnapshot.vias,
  ].flatMap((primitive) =>
    primitive.connectionName === connection.connectionName
      ? []
      : convertCopperToCoreGeometry({
          primitive,
          compiledRules: problem.compiledRules,
          allowedLayers: connection.allowedLayers,
        }),
  )
  return Object.freeze([...obstacleGeometry, ...copperGeometry])
}

function convertCopperToCoreGeometry({
  primitive,
  compiledRules,
  allowedLayers,
}: {
  primitive: HybridCopperPrimitive
  compiledRules: CompiledRoutingRules
  allowedLayers: readonly string[]
}): readonly HybridCoreGeometry[] {
  if (primitive.kind === "segment") {
    if (!allowedLayers.includes(primitive.layer)) return []
    return [
      Object.freeze({
        kind: "segment" as const,
        geometryId: primitive.copperId,
        layer: primitive.layer,
        startX: primitive.start.x,
        startY: primitive.start.y,
        endX: primitive.end.x,
        endY: primitive.end.y,
        widthMm: primitive.widthMm,
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
    .filter((layer) => allowedLayers.includes(layer.name))
    .map((layer) =>
      Object.freeze({
        kind: "circle" as const,
        geometryId: `${primitive.copperId}:${layer.name}`,
        layer: layer.name,
        centerX: primitive.x,
        centerY: primitive.y,
        radiusMm: primitive.padDiameterMm / 2,
      }),
    )
}

function convertCoreRouteToSegments({
  response,
  connection,
  routePlan,
  corridorIndex,
  ownership,
}: {
  response: Extract<HybridCoreSearchResponse, { status: "solved" }>
  connection: CompiledConnectionRules
  routePlan: GlobalRouteObjectPlan
  corridorIndex: number
  ownership: HybridCopperOwnership
}): readonly HybridCopperSegment[] {
  return response.route.flatMap((point, pointIndex) => {
    const nextPoint = response.route[pointIndex + 1]
    if (
      !nextPoint ||
      point.layer !== nextPoint.layer ||
      (point.x === nextPoint.x && point.y === nextPoint.y)
    ) {
      return []
    }
    return [
      Object.freeze({
        kind: "segment" as const,
        copperId: `${routePlan.routeObjectId}:${corridorIndex}:segment:${pointIndex}`,
        connectionName: connection.connectionName,
        layer: point.layer,
        start: Object.freeze({ x: point.x, y: point.y }),
        end: Object.freeze({ x: nextPoint.x, y: nextPoint.y }),
        widthMm: connection.traceWidthMm,
        ownership,
      }),
    ]
  })
}

function convertCoreRouteToVias({
  response,
  connection,
  routePlan,
  corridorIndex,
  ownership,
  compiledRules,
}: {
  response: Extract<HybridCoreSearchResponse, { status: "solved" }>
  connection: CompiledConnectionRules
  routePlan: GlobalRouteObjectPlan
  corridorIndex: number
  ownership: HybridCopperOwnership
  compiledRules: CompiledRoutingRules
}): readonly HybridCopperVia[] {
  return response.vias.map((via, viaIndex) =>
    Object.freeze({
      kind: "via" as const,
      copperId: `${routePlan.routeObjectId}:${corridorIndex}:via:${viaIndex}`,
      connectionName: connection.connectionName,
      x: via.x,
      y: via.y,
      fromLayer: via.fromLayer,
      toLayer: via.toLayer,
      padDiameterMm: compiledRules.viaPadDiameterMm,
      holeDiameterMm: compiledRules.viaHoleDiameterMm,
      ownership,
    }),
  )
}

function findTerminalAtPoint({
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

function createCandidateOwnership(
  ownerRouteObjectId: string,
): HybridCopperOwnership {
  return Object.freeze({
    mutability: "mutable",
    ownerRouteObjectIds: Object.freeze([ownerRouteObjectId]),
  })
}

function createAttempt({
  region,
  routePlan,
  attemptIndex,
  solveTimeMs,
  outcome,
  rejectionReason,
  transactionId,
}: {
  region: DynamicRoutingRegion
  routePlan: GlobalRouteObjectPlan
  attemptIndex: number
  solveTimeMs: number
  outcome: RegionAttemptRecord["outcome"]
  rejectionReason?: string
  transactionId?: string
}): RegionAttemptRecord {
  return Object.freeze({
    attemptId: `serial-attempt:${attemptIndex}:${region.regionId}:${routePlan.routeObjectId}`,
    regionId: region.regionId,
    workerId: "serial-control-plane",
    strategy: "rust-deterministic-grid-search",
    queueWaitMs: 0,
    solveTimeMs,
    outcome,
    rejectionReason,
    transactionId,
  })
}

function createArtifacts({
  topologyPlan,
  demandField,
  regionGraph,
  boundaryContracts,
  copperStore,
  attempts,
}: {
  topologyPlan: SerialHybridEngineArtifacts["topologyPlan"]
  demandField: DemandCapacityField
  regionGraph: SerialHybridEngineArtifacts["regionGraph"]
  boundaryContracts: SerialHybridEngineArtifacts["boundaryContracts"]
  copperStore: TransactionalCopperStore
  attempts: readonly RegionAttemptRecord[]
}): SerialHybridEngineArtifacts {
  return Object.freeze({
    topologyPlan,
    demandCapacityField: demandField.getSnapshot(),
    regionGraph,
    boundaryContracts,
    copperSnapshot: copperStore.getSnapshot(),
    attempts: Object.freeze([...attempts]),
  })
}

function createIncompleteResult({
  topologyPlan,
  demandField,
  regionGraph,
  boundaryContracts,
  copperStore,
  attempts,
  unresolvedRegionIds,
  rejection,
  message,
}: ParametersForIncompleteResult): SerialHybridEngineResult {
  const artifacts = createArtifacts({
    topologyPlan,
    demandField,
    regionGraph,
    boundaryContracts,
    copperStore,
    attempts,
  })
  if (artifacts.copperSnapshot.version === 0) {
    return Object.freeze({ status: "failed", artifacts, message })
  }
  return Object.freeze({
    status: "partial",
    artifacts,
    unresolvedRegionIds: Object.freeze([...unresolvedRegionIds]),
    rejection,
    message,
  })
}

type ParametersForIncompleteResult = {
  topologyPlan: SerialHybridEngineArtifacts["topologyPlan"]
  demandField: DemandCapacityField
  regionGraph: SerialHybridEngineArtifacts["regionGraph"]
  boundaryContracts: SerialHybridEngineArtifacts["boundaryContracts"]
  copperStore: TransactionalCopperStore
  attempts: readonly RegionAttemptRecord[]
  failedRegionId: string
  unresolvedRegionIds: readonly string[]
  rejection?: Extract<SerialHybridEngineResult, { status: "partial" }>["rejection"]
  message: string
}

function createFailedResult({
  topologyPlan,
  demandField,
  regionGraph,
  boundaryContracts,
  copperStore,
  attempts,
  failedRegionId,
  message,
}: {
  topologyPlan: SerialHybridEngineArtifacts["topologyPlan"]
  demandField: DemandCapacityField
  regionGraph: SerialHybridEngineArtifacts["regionGraph"]
  boundaryContracts: SerialHybridEngineArtifacts["boundaryContracts"]
  copperStore: TransactionalCopperStore
  attempts: readonly RegionAttemptRecord[]
  failedRegionId?: string
  message: string
}): SerialHybridEngineResult {
  return Object.freeze({
    status: "failed",
    artifacts: createArtifacts({
      topologyPlan,
      demandField,
      regionGraph,
      boundaryContracts,
      copperStore,
      attempts,
    }),
    failedRegionId,
    message,
  })
}

function stableStringHash(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function validateConfiguration(
  configuration: SerialHybridEngineConfiguration,
): void {
  const positiveIntegerValues = [
    configuration.maximumSearchExpansions,
    configuration.maximumActivationRings,
    configuration.maximumTransactionHistory,
    configuration.maximumDemandCellCount,
    configuration.maximumRegionCount,
    configuration.maximumRegionMutationCount,
    configuration.maximumMergeRegionCount,
    configuration.maximumEstimatedMemoryBytesPerObject,
    configuration.maximumWaveMemoryBytes,
  ]
  if (
    positiveIntegerValues.some(
      (value) => !Number.isSafeInteger(value) || value <= 0,
    ) ||
    !Number.isSafeInteger(configuration.deterministicSeed) ||
    configuration.deterministicSeed < 0
  ) {
    throw new Error("serial hybrid engine configuration contains an invalid bound")
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
