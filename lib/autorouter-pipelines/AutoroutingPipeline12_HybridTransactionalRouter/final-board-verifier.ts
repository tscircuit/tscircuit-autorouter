import {
  findCoupledRouteConstraintViolation,
  isConnectionFullyConnected,
} from "./coupled-route-constraints"
import {
  primitiveEdgeDistance,
  primitiveIsInsideBoard,
  segmentToRotatedRectEdgeDistance,
  viaToRotatedRectEdgeDistance,
} from "./exact-geometry"
import { TransactionalCopperStore } from "./transactional-copper-store"
import type {
  HybridCopperPrimitive,
  HybridCopperSnapshot,
} from "./transactional-copper-types"
import type {
  CompiledConnectionRules,
  CompiledRoutingRules,
  LayerName,
  TypedRoutingProblem,
} from "./types"

const GEOMETRY_EPSILON = 1e-9

export type FinalBoardViolationCode =
  | "terminal_connectivity"
  | "unintended_connectivity"
  | "clearance"
  | "trace_width"
  | "via_dimensions"
  | "via_span"
  | "via_budget"
  | "board_outline"
  | "obstacle_clearance"
  | "via_in_pad"
  | "differential_pair"
  | "bus"
  | "power"
  | "preloaded_copper_continuity"

export type FinalBoardViolation = {
  readonly code: FinalBoardViolationCode
  readonly message: string
  readonly connectionNames: readonly string[]
  readonly copperIds: readonly string[]
}

export type VerifiedFinalBoard = {
  readonly status: "verified"
  readonly routeHash: string
  readonly checkedPrimitiveCount: number
  readonly checkedConnectionCount: number
  readonly exactGeometryPredicateCalls: number
}

export type FinalBoardVerificationResult =
  | VerifiedFinalBoard
  | {
      readonly status: "failed"
      readonly violations: readonly FinalBoardViolation[]
      readonly checkedPrimitiveCount: number
      readonly checkedConnectionCount: number
      readonly exactGeometryPredicateCalls: number
    }

export function verifyFinalBoard({
  problem,
  copperSnapshot,
  maximumViolationCount,
}: {
  problem: TypedRoutingProblem
  copperSnapshot: HybridCopperSnapshot
  maximumViolationCount: number
}): FinalBoardVerificationResult {
  if (!Number.isSafeInteger(maximumViolationCount) || maximumViolationCount <= 0) {
    throw new Error("maximumViolationCount must be a positive safe integer")
  }
  const violations: FinalBoardViolation[] = []
  let exactGeometryPredicateCalls = 0
  const addViolation = (violation: FinalBoardViolation): void => {
    if (violations.length < maximumViolationCount) {
      violations.push(Object.freeze(violation))
    }
  }
  const primitives: readonly HybridCopperPrimitive[] = [
    ...copperSnapshot.segments,
    ...copperSnapshot.vias,
  ]
  const preloadedCopperIdPrefixes = problem.compiledRules.preloadedCopper.map(
    (copper) => `${copper.trace.pcb_trace_id}:`,
  )
  for (const primitive of primitives) {
    const connection = getConnection({
      compiledRules: problem.compiledRules,
      connectionName: primitive.connectionName,
    })
    if (!connection) {
      addViolation(
        createViolation({
          code: "unintended_connectivity",
          message: `${primitive.copperId} references an unknown connection`,
          connectionNames: [primitive.connectionName],
          copperIds: [primitive.copperId],
        }),
      )
      continue
    }
    exactGeometryPredicateCalls += 1
    if (
      !primitiveIsInsideBoard({
        primitive,
        boardBounds: problem.compiledRules.boardBounds,
        boardOutline: problem.compiledRules.boardOutline,
        boardEdgeClearanceMm: problem.compiledRules.clearances.boardEdgeMm,
      })
    ) {
      addViolation(
        createViolation({
          code: "board_outline",
          message: `${primitive.copperId} violates the final board outline clearance`,
          connectionNames: [primitive.connectionName],
          copperIds: [primitive.copperId],
        }),
      )
    }
    const isPreloaded = preloadedCopperIdPrefixes.some((prefix) =>
      primitive.copperId.startsWith(prefix),
    )
    if (primitive.kind === "segment") {
      if (!connection.allowedLayers.includes(primitive.layer)) {
        addViolation(
          createViolation({
            code: "trace_width",
            message: `${primitive.copperId} uses disallowed layer ${primitive.layer}`,
            connectionNames: [primitive.connectionName],
            copperIds: [primitive.copperId],
          }),
        )
      }
      if (
        !Number.isFinite(primitive.widthMm) ||
        primitive.widthMm + GEOMETRY_EPSILON < connection.traceWidthMm ||
        (!isPreloaded &&
          Math.abs(primitive.widthMm - connection.traceWidthMm) >
            GEOMETRY_EPSILON)
      ) {
        addViolation(
          createViolation({
            code: "trace_width",
            message: `${primitive.copperId} does not use final compiled width ${connection.traceWidthMm}mm`,
            connectionNames: [primitive.connectionName],
            copperIds: [primitive.copperId],
          }),
        )
      }
    } else {
      if (
        primitive.padDiameterMm + GEOMETRY_EPSILON <
          problem.compiledRules.viaPadDiameterMm ||
        primitive.holeDiameterMm + GEOMETRY_EPSILON <
          problem.compiledRules.viaHoleDiameterMm ||
        primitive.padDiameterMm <= primitive.holeDiameterMm
      ) {
        addViolation(
          createViolation({
            code: "via_dimensions",
            message: `${primitive.copperId} violates final via pad or hole dimensions`,
            connectionNames: [primitive.connectionName],
            copperIds: [primitive.copperId],
          }),
        )
      }
      if (
        !connection.allowedLayers.includes(primitive.fromLayer) ||
        !connection.allowedLayers.includes(primitive.toLayer) ||
        !isLegalViaSpan({ primitive, compiledRules: problem.compiledRules })
      ) {
        addViolation(
          createViolation({
            code: "via_span",
            message: `${primitive.copperId} uses an illegal final via span`,
            connectionNames: [primitive.connectionName],
            copperIds: [primitive.copperId],
          }),
        )
      }
    }
    for (const obstacle of problem.compiledRules.obstacles) {
      if (
        !getPrimitiveLayers({ primitive, compiledRules: problem.compiledRules }).some(
          (layer) => obstacle.layers.includes(layer),
        )
      ) {
        continue
      }
      exactGeometryPredicateCalls += 1
      const distance =
        primitive.kind === "segment"
          ? segmentToRotatedRectEdgeDistance({ segment: primitive, rect: obstacle })
          : viaToRotatedRectEdgeDistance({ via: primitive, rect: obstacle })
      if (obstacle.connectedTo.includes(primitive.connectionName)) {
        if (
          primitive.kind === "via" &&
          !problem.compiledRules.allowViaInPad &&
          distance <= GEOMETRY_EPSILON
        ) {
          addViolation(
            createViolation({
              code: "via_in_pad",
              message: `${primitive.copperId} overlaps a connected pad while via-in-pad is disabled`,
              connectionNames: [primitive.connectionName],
              copperIds: [primitive.copperId],
            }),
          )
        }
        continue
      }
      const requiredClearance =
        primitive.kind === "segment"
          ? problem.compiledRules.clearances.traceToPadEdgeMm
          : problem.compiledRules.clearances.viaToPadEdgeMm
      if (distance + GEOMETRY_EPSILON < requiredClearance) {
        addViolation(
          createViolation({
            code: "obstacle_clearance",
            message: `${primitive.copperId} has ${distance}mm final obstacle clearance; ${requiredClearance}mm is required`,
            connectionNames: [primitive.connectionName],
            copperIds: [primitive.copperId],
          }),
        )
      }
    }
  }
  for (let firstIndex = 0; firstIndex < primitives.length; firstIndex++) {
    for (
      let secondIndex = firstIndex + 1;
      secondIndex < primitives.length;
      secondIndex++
    ) {
      const first = primitives[firstIndex]!
      const second = primitives[secondIndex]!
      if (
        first.connectionName === second.connectionName ||
        !primitivesShareLayer({
          first,
          second,
          compiledRules: problem.compiledRules,
        })
      ) {
        continue
      }
      exactGeometryPredicateCalls += 1
      const distance = primitiveEdgeDistance({ first, second })
      if (distance <= 0) {
        addViolation(
          createViolation({
            code: "unintended_connectivity",
            message: `${first.copperId} shorts to foreign copper ${second.copperId}`,
            connectionNames: [first.connectionName, second.connectionName],
            copperIds: [first.copperId, second.copperId],
          }),
        )
        continue
      }
      const requiredClearance =
        first.kind === "via" || second.kind === "via"
          ? problem.compiledRules.clearances.viaToTraceEdgeMm
          : problem.compiledRules.clearances.traceToTraceMm
      if (distance + GEOMETRY_EPSILON < requiredClearance) {
        addViolation(
          createViolation({
            code: "clearance",
            message: `${first.copperId} is ${distance}mm from ${second.copperId}; ${requiredClearance}mm is required`,
            connectionNames: [first.connectionName, second.connectionName],
            copperIds: [first.copperId, second.copperId],
          }),
        )
      }
    }
  }
  for (const connection of problem.compiledRules.connections) {
    if (
      !isConnectionFullyConnected({
        compiledRules: problem.compiledRules,
        copperSnapshot,
        connection,
      })
    ) {
      addViolation(
        createViolation({
          code: "terminal_connectivity",
          message: `${connection.connectionName} does not physically connect every declared terminal`,
          connectionNames: [connection.connectionName],
          copperIds: primitives
            .filter(
              (primitive) =>
                primitive.connectionName === connection.connectionName,
            )
            .map((primitive) => primitive.copperId),
        }),
      )
    }
    const viaCount = copperSnapshot.vias.filter(
      (via) => via.connectionName === connection.connectionName,
    ).length
    if (viaCount > connection.viaBudget.hardMaximum) {
      addViolation(
        createViolation({
          code: "via_budget",
          message: `${connection.connectionName} uses ${viaCount} vias; hard maximum is ${connection.viaBudget.hardMaximum}`,
          connectionNames: [connection.connectionName],
          copperIds: copperSnapshot.vias
            .filter((via) => via.connectionName === connection.connectionName)
            .map((via) => via.copperId),
        }),
      )
    }
  }
  const coupledViolation = findCoupledRouteConstraintViolation({
    compiledRules: problem.compiledRules,
    copperSnapshot,
    affectedConnectionNames: new Set(
      problem.compiledRules.connections.map(
        (connection) => connection.connectionName,
      ),
    ),
  })
  if (coupledViolation) {
    addViolation(
      createViolation({
        code:
          coupledViolation.code === "differential_pair_constraint_violation"
            ? "differential_pair"
            : coupledViolation.code === "bus_constraint_violation"
              ? "bus"
              : "power",
        message: coupledViolation.message,
        connectionNames: coupledViolation.connectionNames,
        copperIds: coupledViolation.conflictingCopperIds,
      }),
    )
  }
  const initialSnapshot = new TransactionalCopperStore({
    problem,
    maximumTransactionHistory: 1,
  }).getSnapshot()
  for (const initialPrimitive of [
    ...initialSnapshot.segments,
    ...initialSnapshot.vias,
  ]) {
    const finalPrimitive = primitives.find(
      (primitive) => primitive.copperId === initialPrimitive.copperId,
    )
    if (
      !finalPrimitive ||
      canonicalPrimitive(finalPrimitive) !== canonicalPrimitive(initialPrimitive)
    ) {
      addViolation(
        createViolation({
          code: "preloaded_copper_continuity",
          message: `preloaded copper ${initialPrimitive.copperId} was not preserved exactly`,
          connectionNames: [initialPrimitive.connectionName],
          copperIds: [initialPrimitive.copperId],
        }),
      )
    }
  }
  const commonResult = {
    checkedPrimitiveCount: primitives.length,
    checkedConnectionCount: problem.compiledRules.connections.length,
    exactGeometryPredicateCalls,
  }
  return violations.length > 0
    ? Object.freeze({
        status: "failed" as const,
        violations: Object.freeze(violations),
        ...commonResult,
      })
    : Object.freeze({
        status: "verified" as const,
        routeHash: createRouteHash(copperSnapshot),
        ...commonResult,
      })
}

function getConnection({
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

function isLegalViaSpan({
  primitive,
  compiledRules,
}: {
  primitive: Extract<HybridCopperPrimitive, { kind: "via" }>
  compiledRules: CompiledRoutingRules
}): boolean {
  return compiledRules.legalViaSpans.some(
    (span) =>
      (span.startLayer === primitive.fromLayer &&
        span.endLayer === primitive.toLayer) ||
      (span.startLayer === primitive.toLayer &&
        span.endLayer === primitive.fromLayer),
  )
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
  if (startIndex < 0 || endIndex < 0) return []
  return compiledRules.layerStack
    .slice(Math.min(startIndex, endIndex), Math.max(startIndex, endIndex) + 1)
    .map((layer) => layer.name)
}

function canonicalPrimitive(primitive: HybridCopperPrimitive): string {
  return JSON.stringify(primitive)
}

function createRouteHash(copperSnapshot: HybridCopperSnapshot): string {
  const canonical = JSON.stringify({
    segments: [...copperSnapshot.segments].sort((first, second) =>
      first.copperId.localeCompare(second.copperId),
    ),
    vias: [...copperSnapshot.vias].sort((first, second) =>
      first.copperId.localeCompare(second.copperId),
    ),
  })
  let firstHash = 2166136261
  let secondHash = 2246822519
  for (let index = 0; index < canonical.length; index++) {
    const code = canonical.charCodeAt(index)
    firstHash = Math.imul(firstHash ^ code, 16777619)
    secondHash = Math.imul(secondHash ^ code, 3266489917)
  }
  return `${(firstHash >>> 0).toString(16).padStart(8, "0")}${(
    secondHash >>> 0
  )
    .toString(16)
    .padStart(8, "0")}`
}

function createViolation({
  code,
  message,
  connectionNames,
  copperIds,
}: FinalBoardViolation): FinalBoardViolation {
  return Object.freeze({
    code,
    message,
    connectionNames: Object.freeze([...connectionNames]),
    copperIds: Object.freeze([...copperIds]),
  })
}
