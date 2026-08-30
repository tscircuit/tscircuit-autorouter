import type { SimplifiedPcbTrace } from "../../types"
import type {
  CompiledPreloadedCopper,
  CompiledRoutingRules,
  LayerName,
  RouteObjectId,
  TypedRoutingProblem,
} from "./types"
import type {
  CommittedHybridTransaction,
  HybridCopperOwnership,
  HybridCopperPrimitive,
  HybridCopperSegment,
  HybridCopperSnapshot,
  HybridCopperVia,
  HybridTransactionCommitResult,
  HybridTransactionDelta,
  TransactionValidationResult,
} from "./transactional-copper-types"
import { validateHybridTransaction } from "./validate-transaction"
import { VersionedHybridSpatialIndex } from "./versioned-spatial-index"

type RouteEntry = SimplifiedPcbTrace["route"][number]
type WireEntry = Extract<RouteEntry, { route_type: "wire" }>

export class TransactionalCopperStore {
  private readonly compiledRules: CompiledRoutingRules
  private readonly spatialIndex: VersionedHybridSpatialIndex
  private readonly maximumTransactionHistory: number
  private readonly committedTransactions: CommittedHybridTransaction[] = []
  private segments: readonly HybridCopperSegment[]
  private vias: readonly HybridCopperVia[]
  private copperVersion = 0
  private boundaryContractVersion = 0

  constructor({
    problem,
    maximumTransactionHistory,
  }: {
    problem: TypedRoutingProblem
    maximumTransactionHistory: number
  }) {
    if (
      !Number.isSafeInteger(maximumTransactionHistory) ||
      maximumTransactionHistory <= 0
    ) {
      throw new Error("maximumTransactionHistory must be a positive safe integer")
    }
    this.compiledRules = problem.compiledRules
    this.maximumTransactionHistory = maximumTransactionHistory
    const initialSnapshot = buildInitialCopperSnapshot({ problem })
    this.segments = initialSnapshot.segments
    this.vias = initialSnapshot.vias
    this.spatialIndex = new VersionedHybridSpatialIndex({
      layerStack: this.compiledRules.layerStack,
      primitives: [...initialSnapshot.segments, ...initialSnapshot.vias],
      version: this.copperVersion,
    })
  }

  getSnapshot(): HybridCopperSnapshot {
    return Object.freeze({
      version: this.copperVersion,
      segments: this.segments,
      vias: this.vias,
    })
  }

  getCommittedTransactions(): readonly CommittedHybridTransaction[] {
    return Object.freeze([...this.committedTransactions])
  }

  getBoundaryContractVersion(): number {
    return this.boundaryContractVersion
  }

  setBoundaryContractVersion(nextVersion: number): void {
    if (!Number.isSafeInteger(nextVersion) || nextVersion < this.boundaryContractVersion) {
      throw new Error(
        `boundary contract version cannot move backward from ${this.boundaryContractVersion} to ${nextVersion}`,
      )
    }
    this.boundaryContractVersion = nextVersion
  }

  validate(delta: HybridTransactionDelta): TransactionValidationResult {
    return validateHybridTransaction({
      delta,
      snapshot: this.getSnapshot(),
      compiledRules: this.compiledRules,
      spatialIndex: this.spatialIndex,
      currentBoundaryContractVersion: this.boundaryContractVersion,
    })
  }

  commit(delta: HybridTransactionDelta): HybridTransactionCommitResult {
    const validation = this.validate(delta)
    if (validation.status === "rejected") return validation
    if (validation.validatedAtCopperVersion !== this.copperVersion) {
      throw new Error(
        `transaction ${delta.transactionId} was not validated at current copper version ${this.copperVersion}`,
      )
    }
    const removedCopperIds = new Set([
      ...delta.removedOwnedTraceIds,
      ...delta.removedOwnedViaIds,
    ])
    const nextSegments = Object.freeze([
      ...this.segments.filter(
        (segment) => !removedCopperIds.has(segment.copperId),
      ),
      ...delta.addedTraces.map(freezeSegment),
    ])
    const nextVias = Object.freeze([
      ...this.vias.filter((via) => !removedCopperIds.has(via.copperId)),
      ...delta.addedVias.map(freezeVia),
    ])
    const nextVersion = this.copperVersion + 1
    this.spatialIndex.applyTransaction({
      removedCopperIds,
      addedPrimitives: [...delta.addedTraces, ...delta.addedVias],
      nextVersion,
    })
    this.segments = nextSegments
    this.vias = nextVias
    this.copperVersion = nextVersion
    const transaction: CommittedHybridTransaction = Object.freeze({
      transactionId: delta.transactionId,
      regionId: delta.regionId,
      committedVersion: nextVersion,
      baseCopperVersion: delta.baseCopperVersion,
      wasStaleRevalidation: validation.wasStaleRevalidation,
      candidateCost: Object.freeze({ ...delta.candidateCost }),
    })
    this.committedTransactions.push(transaction)
    while (
      this.committedTransactions.length > this.maximumTransactionHistory
    ) {
      this.committedTransactions.shift()
    }
    return {
      status: "committed",
      transaction,
      snapshot: this.getSnapshot(),
    }
  }
}

export function buildInitialCopperSnapshot({
  problem,
}: {
  problem: TypedRoutingProblem
}): HybridCopperSnapshot {
  const primitives = problem.compiledRules.preloadedCopper.flatMap((copper) =>
    convertPreloadedCopper({
      copper,
      compiledRules: problem.compiledRules,
      ownerRouteObjectIds: resolvePreloadedOwners({ problem, copper }),
    }),
  )
  return Object.freeze({
    version: 0,
    segments: Object.freeze(
      primitives.filter(
        (primitive): primitive is HybridCopperSegment =>
          primitive.kind === "segment",
      ),
    ),
    vias: Object.freeze(
      primitives.filter(
        (primitive): primitive is HybridCopperVia => primitive.kind === "via",
      ),
    ),
  })
}

function resolvePreloadedOwners({
  problem,
  copper,
}: {
  problem: TypedRoutingProblem
  copper: CompiledPreloadedCopper
}): readonly RouteObjectId[] {
  if (copper.mutability === "immutable") return []
  return Object.freeze(
    copper.ownerConnectionNames.map((connectionName) => {
      const ownership = problem.ownershipByConnection.find(
        (record) => record.connectionName === connectionName,
      )
      if (!ownership) {
        throw new Error(
          `preloaded copper ${copper.trace.pcb_trace_id} has unresolved owner ${connectionName}`,
        )
      }
      return ownership.ownerRouteObjectId
    }),
  )
}

function convertPreloadedCopper({
  copper,
  compiledRules,
  ownerRouteObjectIds,
}: {
  copper: CompiledPreloadedCopper
  compiledRules: CompiledRoutingRules
  ownerRouteObjectIds: readonly RouteObjectId[]
}): readonly HybridCopperPrimitive[] {
  const ownership = createOwnership({
    mutability: copper.mutability,
    ownerRouteObjectIds,
  })
  const primitives: HybridCopperPrimitive[] = []
  for (const [routeIndex, routeEntry] of copper.trace.route.entries()) {
    if (routeEntry.route_type === "via") {
      primitives.push(
        freezeVia({
          kind: "via",
          copperId: `${copper.trace.pcb_trace_id}:via:${routeIndex}`,
          connectionName: copper.trace.connection_name,
          x: routeEntry.x,
          y: routeEntry.y,
          fromLayer: routeEntry.from_layer,
          toLayer: routeEntry.to_layer,
          padDiameterMm:
            routeEntry.via_diameter ?? compiledRules.viaPadDiameterMm,
          holeDiameterMm:
            routeEntry.via_hole_diameter ?? compiledRules.viaHoleDiameterMm,
          ownership,
        }),
      )
      const nextRouteEntry = copper.trace.route[routeIndex + 1]
      if (
        nextRouteEntry?.route_type === "wire" &&
        (routeEntry.from_layer === nextRouteEntry.layer ||
          routeEntry.to_layer === nextRouteEntry.layer) &&
        (routeEntry.x !== nextRouteEntry.x || routeEntry.y !== nextRouteEntry.y)
      ) {
        primitives.push(
          freezeSegment({
            kind: "segment",
            copperId: `${copper.trace.pcb_trace_id}:segment:${routeIndex}`,
            connectionName: copper.trace.connection_name,
            layer: nextRouteEntry.layer,
            start: { x: routeEntry.x, y: routeEntry.y },
            end: { x: nextRouteEntry.x, y: nextRouteEntry.y },
            widthMm: nextRouteEntry.width,
            ownership,
          }),
        )
      }
      continue
    }
    if (routeEntry.route_type === "through_obstacle") {
      for (const layer of getLayersBetween({
        compiledRules,
        fromLayer: routeEntry.from_layer,
        toLayer: routeEntry.to_layer,
      })) {
        primitives.push(
          freezeSegment({
            kind: "segment",
            copperId: `${copper.trace.pcb_trace_id}:through:${routeIndex}:${layer}`,
            connectionName: copper.trace.connection_name,
            layer,
            start: routeEntry.start,
            end: routeEntry.end,
            widthMm: routeEntry.width,
            ownership,
          }),
        )
      }
      continue
    }
    if (routeEntry.route_type === "jumper") {
      throw new Error(
        `preloaded jumper ${copper.trace.pcb_trace_id} has no exact copper width in SimpleRouteJson`,
      )
    }
    const nextRouteEntry = copper.trace.route[routeIndex + 1]
    if (
      nextRouteEntry?.route_type === "wire" &&
      nextRouteEntry.layer === routeEntry.layer &&
      (routeEntry.x !== nextRouteEntry.x || routeEntry.y !== nextRouteEntry.y)
    ) {
      primitives.push(
        freezeSegment({
          kind: "segment",
          copperId: `${copper.trace.pcb_trace_id}:segment:${routeIndex}`,
          connectionName: copper.trace.connection_name,
          layer: routeEntry.layer,
          start: { x: routeEntry.x, y: routeEntry.y },
          end: { x: nextRouteEntry.x, y: nextRouteEntry.y },
          widthMm: routeEntry.width,
          ownership,
        }),
      )
      continue
    }
    if (
      nextRouteEntry?.route_type === "via" &&
      (nextRouteEntry.from_layer === routeEntry.layer ||
        nextRouteEntry.to_layer === routeEntry.layer) &&
      (routeEntry.x !== nextRouteEntry.x || routeEntry.y !== nextRouteEntry.y)
    ) {
      primitives.push(
        freezeSegment({
          kind: "segment",
          copperId: `${copper.trace.pcb_trace_id}:segment:${routeIndex}`,
          connectionName: copper.trace.connection_name,
          layer: routeEntry.layer,
          start: { x: routeEntry.x, y: routeEntry.y },
          end: { x: nextRouteEntry.x, y: nextRouteEntry.y },
          widthMm: routeEntry.width,
          ownership,
        }),
      )
    }
  }
  return Object.freeze(primitives)
}

function getLayersBetween({
  compiledRules,
  fromLayer,
  toLayer,
}: {
  compiledRules: CompiledRoutingRules
  fromLayer: LayerName
  toLayer: LayerName
}): readonly LayerName[] {
  const startIndex = compiledRules.layerStack.findIndex(
    (layer) => layer.name === fromLayer,
  )
  const endIndex = compiledRules.layerStack.findIndex(
    (layer) => layer.name === toLayer,
  )
  return compiledRules.layerStack
    .slice(Math.min(startIndex, endIndex), Math.max(startIndex, endIndex) + 1)
    .map((layer) => layer.name)
}

function createOwnership({
  mutability,
  ownerRouteObjectIds,
}: {
  mutability: CompiledPreloadedCopper["mutability"]
  ownerRouteObjectIds: readonly RouteObjectId[]
}): HybridCopperOwnership {
  return mutability === "immutable"
    ? Object.freeze({
        mutability: "immutable" as const,
        ownerRouteObjectIds: Object.freeze([]) as readonly [],
      })
    : Object.freeze({
        mutability: "mutable" as const,
        ownerRouteObjectIds: Object.freeze([...new Set(ownerRouteObjectIds)]),
      })
}

function freezeSegment(segment: HybridCopperSegment): HybridCopperSegment {
  return Object.freeze({
    ...segment,
    start: Object.freeze({ ...segment.start }),
    end: Object.freeze({ ...segment.end }),
    ownership: freezeOwnership(segment.ownership),
  })
}

function freezeVia(via: HybridCopperVia): HybridCopperVia {
  return Object.freeze({
    ...via,
    ownership: freezeOwnership(via.ownership),
  })
}

function freezeOwnership(
  ownership: HybridCopperOwnership,
): HybridCopperOwnership {
  return ownership.mutability === "immutable"
    ? Object.freeze({
        mutability: "immutable" as const,
        ownerRouteObjectIds: Object.freeze([]) as readonly [],
      })
    : Object.freeze({
        mutability: "mutable" as const,
        ownerRouteObjectIds: Object.freeze([...ownership.ownerRouteObjectIds]),
      })
}
