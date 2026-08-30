import {
  getPrimitiveBounds,
  pointToPrimitiveEdgeDistance,
  primitiveEdgeDistance,
  primitiveIsInsideBoard,
  segmentToRotatedRectEdgeDistance,
  viaToRotatedRectEdgeDistance,
} from "./exact-geometry"
import { areConnectionNamesElectricallyConnected } from "./connection-net-equivalence"
import { findCoupledRouteConstraintViolation } from "./coupled-route-constraints"
import type {
  CompiledConnectionRules,
  CompiledRoutingRules,
  LayerName,
} from "./types"
import type {
  HybridCopperId,
  HybridCopperPrimitive,
  HybridCopperSnapshot,
  HybridTransactionDelta,
  TransactionRejection,
  TransactionRejectionCode,
  TransactionValidationResult,
} from "./transactional-copper-types"
import type { VersionedHybridSpatialIndex } from "./versioned-spatial-index"

const GEOMETRY_EPSILON = 1e-9

type ValidationWork = {
  spatialIndexQueries: number
  drcPredicateCalls: number
}

type ValidationContext = {
  readonly delta: HybridTransactionDelta
  readonly snapshot: HybridCopperSnapshot
  readonly compiledRules: CompiledRoutingRules
  readonly spatialIndex: VersionedHybridSpatialIndex
  readonly currentBoundaryContractVersion: number
  readonly removedCopperIds: ReadonlySet<HybridCopperId>
  readonly addedPrimitives: readonly HybridCopperPrimitive[]
  readonly work: ValidationWork
}

export function validateHybridTransaction({
  delta,
  snapshot,
  compiledRules,
  spatialIndex,
  currentBoundaryContractVersion,
}: {
  delta: HybridTransactionDelta
  snapshot: HybridCopperSnapshot
  compiledRules: CompiledRoutingRules
  spatialIndex: VersionedHybridSpatialIndex
  currentBoundaryContractVersion: number
}): TransactionValidationResult {
  const work: ValidationWork = {
    spatialIndexQueries: 0,
    drcPredicateCalls: 0,
  }
  const wasStaleRevalidation = delta.baseCopperVersion !== snapshot.version
  const removedCopperIds = new Set([
    ...delta.removedOwnedTraceIds,
    ...delta.removedOwnedViaIds,
  ])
  const addedPrimitives: readonly HybridCopperPrimitive[] = [
    ...delta.addedTraces,
    ...delta.addedVias,
  ]
  const context: ValidationContext = {
    delta,
    snapshot,
    compiledRules,
    spatialIndex,
    currentBoundaryContractVersion,
    removedCopperIds,
    addedPrimitives,
    work,
  }
  const rejection =
    validateDeltaShape(context) ??
    validateOwnership(context) ??
    validatePrimitiveRules(context) ??
    validateCandidateCost(context) ??
    validateViaBudgets(context) ??
    validateObstacles(context) ??
    validateCopperClearances(context) ??
    validateTerminalEffects(context) ??
    validateCoupledConstraints(context)
  if (rejection) {
    const reportedRejection =
      wasStaleRevalidation &&
      (rejection.code === "copper_clearance_violation" ||
        rejection.code === "unintended_connectivity" ||
        rejection.code === "ownership_violation")
        ? Object.freeze({
            ...rejection,
            code: "stale_conflict" as const,
            message: `stale transaction conflicts with authoritative version ${snapshot.version}: ${rejection.message}`,
          })
        : rejection
    return {
      status: "rejected",
      rejection: reportedRejection,
      validatedAtCopperVersion: snapshot.version,
      wasStaleRevalidation,
      ...work,
    }
  }
  return {
    status: "accepted",
    transactionId: delta.transactionId,
    validatedAtCopperVersion: snapshot.version,
    wasStaleRevalidation,
    ...work,
  }
}

function validateCoupledConstraints(
  context: ValidationContext,
): TransactionRejection | undefined {
  const resultingSnapshot: HybridCopperSnapshot = Object.freeze({
    version: context.snapshot.version,
    segments: Object.freeze([
      ...context.snapshot.segments.filter(
        (segment) => !context.removedCopperIds.has(segment.copperId),
      ),
      ...context.delta.addedTraces,
    ]),
    vias: Object.freeze([
      ...context.snapshot.vias.filter(
        (via) => !context.removedCopperIds.has(via.copperId),
      ),
      ...context.delta.addedVias,
    ]),
  })
  const affectedConnectionNames = new Set([
    ...context.delta.connectivityEffects.connectionNames,
    ...context.addedPrimitives.map((primitive) => primitive.connectionName),
  ])
  const coupledViolation = findCoupledRouteConstraintViolation({
    compiledRules: context.compiledRules,
    copperSnapshot: resultingSnapshot,
    affectedConnectionNames,
  })
  return coupledViolation
    ? reject(context, {
        code: coupledViolation.code,
        message: coupledViolation.message,
        conflictingCopperIds: coupledViolation.conflictingCopperIds,
        connectionNames: coupledViolation.connectionNames,
      })
    : undefined
}

function validateDeltaShape(
  context: ValidationContext,
): TransactionRejection | undefined {
  const { delta, snapshot, spatialIndex, currentBoundaryContractVersion } = context
  if (!delta.transactionId || !delta.regionId || !delta.ownerRouteObjectId) {
    return reject(context, {
      code: "invalid_delta",
      message: "transaction identity fields must not be empty",
    })
  }
  const authorizedOwnerRouteObjectIds = getAuthorizedOwnerRouteObjectIds(delta)
  if (
    authorizedOwnerRouteObjectIds.some((ownerRouteObjectId) =>
      !ownerRouteObjectId.trim(),
    ) ||
    new Set(authorizedOwnerRouteObjectIds).size !==
      authorizedOwnerRouteObjectIds.length
  ) {
    return reject(context, {
      code: "invalid_delta",
      message: "transaction owner route object identifiers must be nonempty and unique",
    })
  }
  if (
    !Number.isSafeInteger(delta.baseCopperVersion) ||
    delta.baseCopperVersion < 0 ||
    delta.baseCopperVersion > snapshot.version
  ) {
    return reject(context, {
      code: "invalid_delta",
      message: `base copper version ${delta.baseCopperVersion} is not an available authoritative version`,
    })
  }
  if (spatialIndex.version !== snapshot.version) {
    return reject(context, {
      code: "invalid_delta",
      message: `spatial index version ${spatialIndex.version} differs from copper version ${snapshot.version}`,
    })
  }
  if (delta.boundaryContractVersion !== currentBoundaryContractVersion) {
    return reject(context, {
      code: "boundary_contract_mismatch",
      message: `boundary contract version ${delta.boundaryContractVersion} is stale; current version is ${currentBoundaryContractVersion}`,
    })
  }
  const allIds = [
    ...delta.removedOwnedTraceIds,
    ...delta.removedOwnedViaIds,
    ...context.addedPrimitives.map((primitive) => primitive.copperId),
  ]
  if (allIds.some((copperId) => !copperId)) {
    return reject(context, {
      code: "invalid_delta",
      message: "copper identifiers must not be empty",
    })
  }
  if (new Set(allIds).size !== allIds.length) {
    return reject(context, {
      code: "duplicate_copper_id",
      message: "a copper identifier may occur only once in a transaction delta",
      conflictingCopperIds: allIds,
    })
  }
  const existingIds = new Set([
    ...snapshot.segments.map((segment) => segment.copperId),
    ...snapshot.vias.map((via) => via.copperId),
  ])
  const duplicateExisting = context.addedPrimitives.find((primitive) =>
    existingIds.has(primitive.copperId),
  )
  if (duplicateExisting) {
    return reject(context, {
      code: "duplicate_copper_id",
      message: `added copper ${duplicateExisting.copperId} already exists`,
      conflictingCopperIds: [duplicateExisting.copperId],
    })
  }
  return undefined
}

function validateOwnership(
  context: ValidationContext,
): TransactionRejection | undefined {
  const { delta, snapshot } = context
  const existingPrimitives: readonly HybridCopperPrimitive[] = [
    ...snapshot.segments,
    ...snapshot.vias,
  ]
  for (const removedTraceId of delta.removedOwnedTraceIds) {
    const primitive = existingPrimitives.find(
      (candidate) => candidate.copperId === removedTraceId,
    )
    if (primitive?.kind !== "segment") {
      return reject(context, {
        code: "ownership_violation",
        message: `removed trace ${removedTraceId} does not exist as an authoritative segment`,
        conflictingCopperIds: [removedTraceId],
      })
    }
    const ownershipRejection = validateRemovalOwnership({ context, primitive })
    if (ownershipRejection) return ownershipRejection
  }
  for (const removedViaId of delta.removedOwnedViaIds) {
    const primitive = existingPrimitives.find(
      (candidate) => candidate.copperId === removedViaId,
    )
    if (primitive?.kind !== "via") {
      return reject(context, {
        code: "ownership_violation",
        message: `removed via ${removedViaId} does not exist as an authoritative via`,
        conflictingCopperIds: [removedViaId],
      })
    }
    const ownershipRejection = validateRemovalOwnership({ context, primitive })
    if (ownershipRejection) return ownershipRejection
  }
  for (const additionalOwnerRouteObjectId of
    delta.additionalOwnerRouteObjectIds ?? []) {
    const participates = [
      ...context.addedPrimitives,
      ...existingPrimitives.filter((primitive) =>
        context.removedCopperIds.has(primitive.copperId),
      ),
    ].some(
      (primitive) =>
        primitive.ownership.mutability === "mutable" &&
        primitive.ownership.ownerRouteObjectIds.includes(
          additionalOwnerRouteObjectId,
        ),
    )
    if (!participates) {
      return reject(context, {
        code: "ownership_violation",
        message: `additional transaction owner ${additionalOwnerRouteObjectId} does not own any affected copper`,
      })
    }
  }
  return undefined
}

function validateRemovalOwnership({
  context,
  primitive,
}: {
  context: ValidationContext
  primitive: HybridCopperPrimitive
}): TransactionRejection | undefined {
  if (
    primitive.ownership.mutability === "immutable" ||
    !primitive.ownership.ownerRouteObjectIds.some((ownerRouteObjectId) =>
      getAuthorizedOwnerRouteObjectIds(context.delta).includes(
        ownerRouteObjectId,
      ),
    )
  ) {
    return reject(context, {
      code: "ownership_violation",
      message: `${primitive.copperId} is not removable by an authorized transaction owner`,
      conflictingCopperIds: [primitive.copperId],
      connectionNames: [primitive.connectionName],
    })
  }
  return undefined
}

function validatePrimitiveRules(
  context: ValidationContext,
): TransactionRejection | undefined {
  for (const primitive of context.addedPrimitives) {
    const connection = getConnectionRules({
      compiledRules: context.compiledRules,
      connectionName: primitive.connectionName,
    })
    if (!connection) {
      return reject(context, {
        code: "unknown_connection",
        message: `copper ${primitive.copperId} references unknown connection ${primitive.connectionName}`,
        conflictingCopperIds: [primitive.copperId],
        connectionNames: [primitive.connectionName],
      })
    }
    const commonRejection = validatePrimitiveCommon({
      context,
      primitive,
      connection,
    })
    if (commonRejection) return commonRejection
    const kindRejection =
      primitive.kind === "segment"
        ? validateSegmentRules({ context, primitive, connection })
        : validateViaRules({ context, primitive, connection })
    if (kindRejection) return kindRejection
  }
  return undefined
}

function validatePrimitiveCommon({
  context,
  primitive,
  connection,
}: {
  context: ValidationContext
  primitive: HybridCopperPrimitive
  connection: CompiledConnectionRules
}): TransactionRejection | undefined {
  const finiteCoordinates =
    primitive.kind === "segment"
      ? [primitive.start.x, primitive.start.y, primitive.end.x, primitive.end.y]
      : [primitive.x, primitive.y]
  if (finiteCoordinates.some((coordinate) => !Number.isFinite(coordinate))) {
    return reject(context, {
      code: "invalid_delta",
      message: `${primitive.copperId} contains a non-finite coordinate`,
      conflictingCopperIds: [primitive.copperId],
      connectionNames: [connection.connectionName],
    })
  }
  if (
    primitive.ownership.mutability !== "mutable" ||
    primitive.ownership.ownerRouteObjectIds.length !== 1 ||
    !getAuthorizedOwnerRouteObjectIds(context.delta).includes(
      primitive.ownership.ownerRouteObjectIds[0]!,
    )
  ) {
    return reject(context, {
      code: "ownership_violation",
      message: `new copper ${primitive.copperId} must be owned only by an authorized proposing route object`,
      conflictingCopperIds: [primitive.copperId],
      connectionNames: [connection.connectionName],
    })
  }
  if (
    !primitiveIsInsideBoard({
      primitive,
      boardBounds: context.compiledRules.boardBounds,
      boardOutline: context.compiledRules.boardOutline,
      boardEdgeClearanceMm: context.compiledRules.clearances.boardEdgeMm,
    })
  ) {
    return reject(context, {
      code: "outside_board_outline",
      message: `${primitive.copperId} violates the compiled board-edge clearance`,
      conflictingCopperIds: [primitive.copperId],
      connectionNames: [connection.connectionName],
    })
  }
  const primitiveBounds = getPrimitiveBounds(primitive)
  const affectedBounds = context.delta.affectedBounds
  if (
    primitiveBounds.minX < affectedBounds.minX ||
    primitiveBounds.maxX > affectedBounds.maxX ||
    primitiveBounds.minY < affectedBounds.minY ||
    primitiveBounds.maxY > affectedBounds.maxY
  ) {
    return reject(context, {
      code: "invalid_delta",
      message: `${primitive.copperId} lies outside the transaction affected bounds`,
      conflictingCopperIds: [primitive.copperId],
      connectionNames: [connection.connectionName],
    })
  }
  return undefined
}

function getAuthorizedOwnerRouteObjectIds(
  delta: HybridTransactionDelta,
): readonly string[] {
  return [
    delta.ownerRouteObjectId,
    ...(delta.additionalOwnerRouteObjectIds ?? []),
  ]
}

function validateSegmentRules({
  context,
  primitive,
  connection,
}: {
  context: ValidationContext
  primitive: Extract<HybridCopperPrimitive, { kind: "segment" }>
  connection: CompiledConnectionRules
}): TransactionRejection | undefined {
  if (
    primitive.widthMm < connection.traceWidthMm ||
    !Number.isFinite(primitive.widthMm)
  ) {
    return reject(context, {
      code: "trace_width_violation",
      message: `${primitive.copperId} width ${primitive.widthMm} is below compiled width ${connection.traceWidthMm}`,
      conflictingCopperIds: [primitive.copperId],
      connectionNames: [connection.connectionName],
    })
  }
  if (!connection.allowedLayers.includes(primitive.layer)) {
    return reject(context, {
      code: "illegal_layer",
      message: `${primitive.copperId} uses disallowed layer ${primitive.layer}`,
      conflictingCopperIds: [primitive.copperId],
      connectionNames: [connection.connectionName],
    })
  }
  if (
    primitive.start.x === primitive.end.x &&
    primitive.start.y === primitive.end.y
  ) {
    return reject(context, {
      code: "invalid_delta",
      message: `${primitive.copperId} is a zero-length segment`,
      conflictingCopperIds: [primitive.copperId],
      connectionNames: [connection.connectionName],
    })
  }
  return undefined
}

function validateViaRules({
  context,
  primitive,
  connection,
}: {
  context: ValidationContext
  primitive: Extract<HybridCopperPrimitive, { kind: "via" }>
  connection: CompiledConnectionRules
}): TransactionRejection | undefined {
  if (
    primitive.padDiameterMm < context.compiledRules.viaPadDiameterMm ||
    primitive.holeDiameterMm < context.compiledRules.viaHoleDiameterMm ||
    primitive.padDiameterMm <= primitive.holeDiameterMm ||
    !Number.isFinite(primitive.padDiameterMm) ||
    !Number.isFinite(primitive.holeDiameterMm)
  ) {
    return reject(context, {
      code: "via_dimension_violation",
      message: `${primitive.copperId} violates compiled via dimensions`,
      conflictingCopperIds: [primitive.copperId],
      connectionNames: [connection.connectionName],
    })
  }
  if (
    !connection.allowedLayers.includes(primitive.fromLayer) ||
    !connection.allowedLayers.includes(primitive.toLayer)
  ) {
    return reject(context, {
      code: "illegal_layer",
      message: `${primitive.copperId} uses a layer outside ${connection.connectionName}'s allowed layers`,
      conflictingCopperIds: [primitive.copperId],
      connectionNames: [connection.connectionName],
    })
  }
  const legalSpan = context.compiledRules.legalViaSpans.some(
    (span) =>
      (span.startLayer === primitive.fromLayer &&
        span.endLayer === primitive.toLayer) ||
      (span.startLayer === primitive.toLayer &&
        span.endLayer === primitive.fromLayer),
  )
  if (!legalSpan) {
    return reject(context, {
      code: "illegal_via_span",
      message: `${primitive.copperId} uses illegal via span ${primitive.fromLayer} to ${primitive.toLayer}`,
      conflictingCopperIds: [primitive.copperId],
      connectionNames: [connection.connectionName],
    })
  }
  return undefined
}

function validateViaBudgets(
  context: ValidationContext,
): TransactionRejection | undefined {
  for (const connection of context.compiledRules.connections) {
    const existingViaCount = context.snapshot.vias.filter(
      (via) =>
        via.connectionName === connection.connectionName &&
        !context.removedCopperIds.has(via.copperId),
    ).length
    const addedViaCount = context.delta.addedVias.filter(
      (via) => via.connectionName === connection.connectionName,
    ).length
    const resultingViaCount = existingViaCount + addedViaCount
    if (resultingViaCount > connection.viaBudget.hardMaximum) {
      return reject(context, {
        code: "via_budget_exceeded",
        message: `${connection.connectionName} would use ${resultingViaCount} vias, exceeding hard maximum ${connection.viaBudget.hardMaximum}`,
        conflictingCopperIds: context.delta.addedVias
          .filter((via) => via.connectionName === connection.connectionName)
          .map((via) => via.copperId),
        connectionNames: [connection.connectionName],
      })
    }
    if (
      resultingViaCount > connection.viaBudget.softMaximum &&
      (!context.delta.candidateCost.softViaBudgetExceeded ||
        !context.delta.candidateCost.softViaBudgetJustification)
    ) {
      return reject(context, {
        code: "via_budget_exceeded",
        message: `${connection.connectionName} exceeds its soft via budget without an explicit justification`,
        connectionNames: [connection.connectionName],
      })
    }
  }
  if (context.delta.candidateCost.viaCount !== context.delta.addedVias.length) {
    return reject(context, {
      code: "invalid_delta",
      message: "candidateCost.viaCount must equal the number of added vias",
    })
  }
  return undefined
}

function validateCandidateCost(
  context: ValidationContext,
): TransactionRejection | undefined {
  const cost = context.delta.candidateCost
  if (
    !Number.isSafeInteger(cost.viaCount) ||
    cost.viaCount < 0 ||
    !Number.isSafeInteger(cost.bendCount) ||
    cost.bendCount < 0 ||
    !Number.isFinite(cost.totalLengthMm) ||
    cost.totalLengthMm < 0 ||
    !Number.isFinite(cost.congestionCost) ||
    cost.congestionCost < 0
  ) {
    return reject(context, {
      code: "invalid_delta",
      message: "candidate cost fields must be finite nonnegative values",
    })
  }
  const measuredLength = context.delta.addedTraces.reduce(
    (total, segment) =>
      total +
      Math.hypot(
        segment.end.x - segment.start.x,
        segment.end.y - segment.start.y,
      ),
    0,
  )
  if (Math.abs(measuredLength - cost.totalLengthMm) > 1e-9) {
    return reject(context, {
      code: "invalid_delta",
      message: `candidate length ${cost.totalLengthMm} differs from measured length ${measuredLength}`,
    })
  }
  return undefined
}

function validateObstacles(
  context: ValidationContext,
): TransactionRejection | undefined {
  for (const primitive of context.addedPrimitives) {
    for (const obstacle of context.compiledRules.obstacles) {
      if (!primitiveTouchesAnyLayer({ primitive, layers: obstacle.layers, context })) {
        continue
      }
      context.work.drcPredicateCalls += 1
      const distance =
        primitive.kind === "segment"
          ? segmentToRotatedRectEdgeDistance({ segment: primitive, rect: obstacle })
          : viaToRotatedRectEdgeDistance({ via: primitive, rect: obstacle })
      const requiredClearance =
        primitive.kind === "segment"
          ? context.compiledRules.clearances.traceToPadEdgeMm
          : context.compiledRules.clearances.viaToPadEdgeMm
      if (
        obstacle.connectedTo.some((connectedName) =>
          areConnectionNamesElectricallyConnected({
            compiledRules: context.compiledRules,
            firstConnectionName: primitive.connectionName,
            secondConnectionName: connectedName,
          }),
        )
      ) {
        if (
          primitive.kind === "via" &&
          !context.compiledRules.allowViaInPad &&
          distance <= GEOMETRY_EPSILON
        ) {
          return reject(context, {
            code: "obstacle_clearance_violation",
            message: `${primitive.copperId} at (${primitive.x}, ${primitive.y}) is ${distance}mm from connected pad ${obstacle.obstacleId ?? "unnamed"}; via-in-pad is disabled`,
            conflictingCopperIds: [primitive.copperId],
            connectionNames: [primitive.connectionName],
          })
        }
        continue
      }
      if (distance + GEOMETRY_EPSILON < requiredClearance) {
        return reject(context, {
          code: "obstacle_clearance_violation",
          message: `${primitive.copperId} is ${distance}mm from obstacle ${obstacle.obstacleId ?? "unnamed"}; ${requiredClearance}mm is required`,
          conflictingCopperIds: [primitive.copperId],
          connectionNames: [primitive.connectionName],
        })
      }
    }
  }
  return undefined
}

function validateCopperClearances(
  context: ValidationContext,
): TransactionRejection | undefined {
  for (const [primitiveIndex, primitive] of context.addedPrimitives.entries()) {
    const maximumClearance = Math.max(
      context.compiledRules.clearances.traceToTraceMm,
      context.compiledRules.clearances.viaToTraceEdgeMm,
    )
    context.work.spatialIndexQueries += 1
    const indexedCandidates = context.spatialIndex.query({
      primitive,
      clearanceMm: maximumClearance,
      excludedCopperIds: context.removedCopperIds,
    })
    const candidatePrimitives = [
      ...indexedCandidates,
      ...context.addedPrimitives.slice(0, primitiveIndex),
    ]
    for (const other of candidatePrimitives) {
      if (
        areConnectionNamesElectricallyConnected({
          compiledRules: context.compiledRules,
          firstConnectionName: primitive.connectionName,
          secondConnectionName: other.connectionName,
        })
      ) {
        continue
      }
      context.work.drcPredicateCalls += 1
      const distance = primitiveEdgeDistance({ first: primitive, second: other })
      if (distance <= 0) {
        return reject(context, {
          code: "unintended_connectivity",
          message: `${primitive.copperId} touches foreign copper ${other.copperId}`,
          conflictingCopperIds: [primitive.copperId, other.copperId],
          connectionNames: [primitive.connectionName, other.connectionName],
        })
      }
      const requiredClearance =
        primitive.kind === "via" || other.kind === "via"
          ? context.compiledRules.clearances.viaToTraceEdgeMm
          : context.compiledRules.clearances.traceToTraceMm
      if (distance + GEOMETRY_EPSILON < requiredClearance) {
        return reject(context, {
          code: "copper_clearance_violation",
          message: `${primitive.copperId} is ${distance}mm from foreign copper ${other.copperId}; ${requiredClearance}mm is required`,
          conflictingCopperIds: [primitive.copperId, other.copperId],
          connectionNames: [primitive.connectionName, other.connectionName],
        })
      }
    }
  }
  return undefined
}

function validateTerminalEffects(
  context: ValidationContext,
): TransactionRejection | undefined {
  const effectConnections = new Set(context.delta.connectivityEffects.connectionNames)
  const resultingPrimitives = [
    ...context.snapshot.segments.filter(
      (segment) => !context.removedCopperIds.has(segment.copperId),
    ),
    ...context.snapshot.vias.filter(
      (via) => !context.removedCopperIds.has(via.copperId),
    ),
    ...context.addedPrimitives,
  ]
  for (const terminalId of context.delta.connectivityEffects.connectedTerminalIds) {
    const terminalConnections = context.compiledRules.connections
      .filter(
        (candidate) =>
        candidate.terminals.some(
          (terminal) => terminal.terminalId === terminalId,
        ) &&
        [...effectConnections].some((effectConnectionName) =>
          candidate.electricallyConnectedConnectionNames.includes(
            effectConnectionName,
          ),
        ),
      )
      .sort(
        (first, second) =>
          Number(effectConnections.has(second.connectionName)) -
          Number(effectConnections.has(first.connectionName)),
      )
    const connection = terminalConnections[0]
    const terminal = connection?.terminals.find(
      (candidate) => candidate.terminalId === terminalId,
    )
    if (!connection || !terminal) {
      return reject(context, {
        code: "terminal_connectivity_violation",
        message: `terminal effect ${terminalId} does not belong to a declared affected connection`,
      })
    }
    const touchesCopper = resultingPrimitives.some(
      (primitive) =>
        connection.electricallyConnectedConnectionNames.includes(
          primitive.connectionName,
        ) &&
        terminal.layers.some(
          (layer) =>
            pointToPrimitiveEdgeDistance({
              point: terminal,
              layer,
              primitive,
              viaLayers: getViaLayers({ primitive, context }),
            }) <= 1e-9,
        ),
    )
    if (!touchesCopper) {
      return reject(context, {
        code: "terminal_connectivity_violation",
        message: `terminal effect ${terminalId} is not physically touched by ${connection.connectionName} copper`,
        connectionNames: [connection.connectionName],
      })
    }
  }
  return undefined
}

function getConnectionRules({
  compiledRules,
  connectionName,
}: {
  compiledRules: CompiledRoutingRules
  connectionName: string
}): CompiledConnectionRules | undefined {
  return compiledRules.connections.find(
    (connection) => connection.connectionName === connectionName,
  )
}

function primitiveTouchesAnyLayer({
  primitive,
  layers,
  context,
}: {
  primitive: HybridCopperPrimitive
  layers: readonly LayerName[]
  context: ValidationContext
}): boolean {
  if (primitive.kind === "segment") return layers.includes(primitive.layer)
  return getViaLayers({ primitive, context }).some((layer) =>
    layers.includes(layer),
  )
}

function getViaLayers({
  primitive,
  context,
}: {
  primitive: HybridCopperPrimitive
  context: ValidationContext
}): readonly LayerName[] {
  if (primitive.kind === "segment") return [primitive.layer]
  const startIndex = context.compiledRules.layerStack.findIndex(
    (layer) => layer.name === primitive.fromLayer,
  )
  const endIndex = context.compiledRules.layerStack.findIndex(
    (layer) => layer.name === primitive.toLayer,
  )
  if (startIndex < 0 || endIndex < 0) return []
  return context.compiledRules.layerStack
    .slice(Math.min(startIndex, endIndex), Math.max(startIndex, endIndex) + 1)
    .map((layer) => layer.name)
}

function reject(
  context: ValidationContext,
  {
    code,
    message,
    conflictingCopperIds = [],
    connectionNames = [],
  }: {
    code: TransactionRejectionCode
    message: string
    conflictingCopperIds?: readonly HybridCopperId[]
    connectionNames?: readonly string[]
  },
): TransactionRejection {
  return {
    code,
    message,
    transactionId: context.delta.transactionId,
    conflictingCopperIds: Object.freeze([...conflictingCopperIds]),
    connectionNames: Object.freeze([...connectionNames]),
  }
}
