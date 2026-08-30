import type {
  Obstacle,
  SimpleRouteJson,
  SimplifiedPcbTrace,
} from "../../types"

export type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T

export type ConnectionName = string
export type LayerName = string
export type RouteClassName = string
export type RouteObjectId = string
export type TerminalId = string
export type PcbTraceId = string

export type HybridRouterDiagnostic = {
  readonly code: string
  readonly message: string
  readonly regionIds: readonly string[]
  readonly connectionNames: readonly ConnectionName[]
}

export type HybridRouterMetrics = {
  readonly totalElapsedMs: number
  readonly stageElapsedMs: Readonly<Record<string, number>>
  readonly regionElapsedMs: Readonly<Record<string, number>>
  readonly queueWaitMs: number
  readonly workerCpuMs: number
  readonly solverElapsedMs: number
  readonly searchExpansions: number
  readonly candidatesConstructed: number
  readonly candidatesStepped: number
  readonly drcPredicateCalls: number
  readonly spatialIndexQueries: number
  readonly transferredBytes: number
  readonly clonedBytes: number
  readonly transactionCommits: number
  readonly transactionRejections: number
  readonly staleRevalidations: number
  readonly cancellations: number
  readonly regionSplits: number
  readonly regionMerges: number
  readonly regionRequeues: number
  readonly solverStateRebuilds: number
  readonly geometryAllocations: number
  readonly peakHeapBytes: number
  readonly peakRssBytes: number
  readonly workerUtilization: number
  readonly cacheHits: number
  readonly cacheMisses: number
  readonly cacheEvictions: number
  readonly cacheStoredBytes: number
  readonly cacheValidationMs: number
  readonly viaCount: number
  readonly routedLengthMm: number
  readonly bendCount: number
  readonly solveOutcome: "solved" | "partial" | "failed"
}

export type HybridRouterResult =
  | {
      readonly status: "solved"
      readonly routedSimpleRouteJson: SimpleRouteJson
      readonly metrics: HybridRouterMetrics
    }
  | {
      readonly status: "partial"
      readonly partialSimpleRouteJson: SimpleRouteJson
      readonly unresolvedConnectionNames: readonly ConnectionName[]
      readonly metrics: HybridRouterMetrics
      readonly diagnostic: HybridRouterDiagnostic
    }
  | {
      readonly status: "failed"
      readonly metrics: HybridRouterMetrics
      readonly diagnostic: HybridRouterDiagnostic
    }

export type HybridLayerRuleInput = {
  readonly name: LayerName
  readonly zIndex: number
  readonly preferredDirection: "horizontal" | "vertical" | "any"
}

export type HybridViaBudgetInput = {
  readonly softMaximum: number
  readonly hardMaximum: number
}

export type HybridRouteClassInput = {
  readonly className: RouteClassName
  readonly traceWidthMm: number
  readonly allowedLayers: readonly LayerName[]
  readonly viaBudget: HybridViaBudgetInput
}

export type HybridConnectionClassAssignmentInput = {
  readonly connectionName: ConnectionName
  readonly className: RouteClassName
  readonly allowedLayers?: readonly LayerName[]
  readonly viaBudget?: HybridViaBudgetInput
}

export type HybridLegalViaSpanInput = {
  readonly fromLayer: LayerName
  readonly toLayer: LayerName
}

export type HybridPowerRuleInput = {
  readonly connectionName: ConnectionName
  readonly topology: "point_to_point" | "tree" | "mesh"
  readonly traceWidthMm: number
  readonly allowedLayers?: readonly LayerName[]
}

export type HybridPreloadedCopperOwnershipInput =
  | {
      readonly pcbTraceId: PcbTraceId
      readonly mutability: "immutable"
      readonly ownerConnectionNames?: never
    }
  | {
      readonly pcbTraceId: PcbTraceId
      readonly mutability: "mutable"
      readonly ownerConnectionNames: readonly ConnectionName[]
    }

export type HybridClearanceRulesInput = {
  readonly traceToTraceMm: number
  readonly traceToPadEdgeMm: number
  readonly viaToTraceEdgeMm: number
  readonly viaToPadEdgeMm: number
  readonly boardEdgeMm: number
}

export type HybridRoutingRulesInput = {
  readonly layerStack: readonly HybridLayerRuleInput[]
  readonly legalViaSpans: readonly HybridLegalViaSpanInput[]
  readonly clearances: HybridClearanceRulesInput
  readonly routingResolutionMm: number
  readonly routeClasses: readonly HybridRouteClassInput[]
  readonly connectionClassAssignments: readonly HybridConnectionClassAssignmentInput[]
  readonly powerRules?: readonly HybridPowerRuleInput[]
  readonly preloadedCopperOwnership?: readonly HybridPreloadedCopperOwnershipInput[]
}

export type CompiledLayerRule = Readonly<HybridLayerRuleInput>
export type CompiledViaBudget = Readonly<HybridViaBudgetInput>

export type CompiledLegalViaSpan = {
  readonly startLayer: LayerName
  readonly endLayer: LayerName
  readonly startZ: number
  readonly endZ: number
}

export type CompiledClearanceRules = Readonly<HybridClearanceRulesInput>

export type CompiledTerminal = {
  readonly terminalId: TerminalId
  readonly x: number
  readonly y: number
  readonly layers: readonly LayerName[]
  readonly pcbPortId?: string
  readonly terminalVia?: {
    readonly toLayer: LayerName
    readonly viaPadDiameterMm: number
  }
}

export type CompiledConnectionRuleBase = {
  readonly connectionName: ConnectionName
  /** Every routed connection identifier that belongs to the same electrical net. */
  readonly electricallyConnectedConnectionNames: readonly ConnectionName[]
  readonly className: RouteClassName
  readonly traceWidthMm: number
  readonly allowedLayers: readonly LayerName[]
  readonly viaBudget: CompiledViaBudget
  readonly terminals: readonly CompiledTerminal[]
}

export type CompiledSignalConnectionRules = CompiledConnectionRuleBase & {
  readonly kind: "signal"
}

export type CompiledPowerConnectionRules = CompiledConnectionRuleBase & {
  readonly kind: "power"
  readonly topology: HybridPowerRuleInput["topology"]
}

export type CompiledConnectionRules =
  | CompiledSignalConnectionRules
  | CompiledPowerConnectionRules

export type CompiledDifferentialPairRules = {
  readonly connectionNames: readonly [ConnectionName, ConnectionName]
  readonly spacingMm: number
  readonly maximumSkewMm: number
  readonly maximumUncoupledLengthMm: number
  readonly allowedLayers: readonly LayerName[]
}

export type CompiledBusRules = {
  readonly busId: string
  readonly orderedConnectionNames: readonly ConnectionName[]
  readonly maximumSkewMm: number
  readonly allowedLayers: readonly LayerName[]
}

export type CompiledPreloadedCopper = {
  readonly trace: DeepReadonly<SimplifiedPcbTrace>
  readonly mutability: "immutable" | "mutable"
  readonly ownerConnectionNames: readonly ConnectionName[]
  readonly hasSharedMutableOwnership: boolean
}

export type HybridBoardBounds = {
  readonly minX: number
  readonly maxX: number
  readonly minY: number
  readonly maxY: number
}

export type HybridBoardPoint = {
  readonly x: number
  readonly y: number
}

export type CompiledRoutingRules = {
  readonly layerStack: readonly CompiledLayerRule[]
  readonly legalViaSpans: readonly CompiledLegalViaSpan[]
  readonly clearances: CompiledClearanceRules
  readonly routingResolutionMm: number
  readonly viaHoleDiameterMm: number
  readonly viaPadDiameterMm: number
  readonly allowViaInPad: boolean
  readonly boardBounds: HybridBoardBounds
  readonly boardOutline: readonly HybridBoardPoint[]
  readonly obstacles: readonly DeepReadonly<Obstacle>[]
  readonly connections: readonly CompiledConnectionRules[]
  readonly differentialPairs: readonly CompiledDifferentialPairRules[]
  readonly buses: readonly CompiledBusRules[]
  readonly preloadedCopper: readonly CompiledPreloadedCopper[]
}

export type HybridValidationRequirement =
  | "terminal_connectivity"
  | "no_unintended_connectivity"
  | "exact_clearance"
  | "legal_via_spans"
  | "via_budget"
  | "board_outline"
  | "differential_pair_spacing"
  | "differential_pair_skew"
  | "maximum_uncoupled_pair_length"
  | "bus_ordering"
  | "bus_skew"
  | "power_topology"
  | "preloaded_copper_continuity"

export type HybridRoutingEnvelope = {
  readonly bounds: HybridBoardBounds
  readonly allowedLayers: readonly LayerName[]
}

export type DirectRouteOwnership = {
  readonly kind: "direct"
  readonly ownerRouteObjectId: RouteObjectId
  readonly connectionNames: readonly ConnectionName[]
}

export type DelegatedRouteOwnership = {
  readonly kind: "delegated"
  readonly ownerRouteObjectId: RouteObjectId
  readonly connectionNames: readonly ConnectionName[]
}

export type RouteOwnership = DirectRouteOwnership | DelegatedRouteOwnership

export type HybridRouteObjectBase = {
  readonly routeObjectId: RouteObjectId
  readonly ownership: RouteOwnership
  readonly tuningEnvelope: HybridRoutingEnvelope
  readonly validationRequirements: readonly HybridValidationRequirement[]
}

export type SignalRouteObject = HybridRouteObjectBase & {
  readonly kind: "signal"
  readonly connection: CompiledSignalConnectionRules
}

export type DifferentialPairRouteObject = HybridRouteObjectBase & {
  readonly kind: "differential_pair"
  readonly rules: CompiledDifferentialPairRules
  readonly members: readonly [SignalRouteObject, SignalRouteObject]
}

export type BusMemberRouteObject =
  | SignalRouteObject
  | DifferentialPairRouteObject

export type BusRouteObject = HybridRouteObjectBase & {
  readonly kind: "bus"
  readonly rules: CompiledBusRules
  readonly members: readonly BusMemberRouteObject[]
}

export type PowerRouteObject = HybridRouteObjectBase & {
  readonly kind: "power"
  readonly connection: CompiledPowerConnectionRules
}

export type PreloadedCopperRouteObject = HybridRouteObjectBase & {
  readonly kind: "preloaded_copper"
  readonly copper: CompiledPreloadedCopper
}

export type TypedRouteObject =
  | SignalRouteObject
  | DifferentialPairRouteObject
  | BusRouteObject
  | PowerRouteObject
  | PreloadedCopperRouteObject

export type RouteObjectOwnershipRecord = {
  readonly connectionName: ConnectionName
  readonly ownerRouteObjectId: RouteObjectId
}

export type TypedRoutingProblem = {
  readonly compiledRules: CompiledRoutingRules
  readonly routeObjects: readonly TypedRouteObject[]
  readonly ownershipByConnection: readonly RouteObjectOwnershipRecord[]
}
