import type { HybridBoardBounds, LayerName } from "./types"

export const HYBRID_ROUTING_CORE_PROTOCOL_VERSION = 1 as const

export type HybridCoreRoutePoint = {
  readonly x: number
  readonly y: number
  readonly layer: LayerName
}

export type HybridCoreGeometry =
  | {
      readonly kind: "circle"
      readonly geometryId: string
      readonly layer: LayerName
      readonly centerX: number
      readonly centerY: number
      readonly radiusMm: number
    }
  | {
      readonly kind: "segment"
      readonly geometryId: string
      readonly layer: LayerName
      readonly startX: number
      readonly startY: number
      readonly endX: number
      readonly endY: number
      readonly widthMm: number
    }
  | {
      readonly kind: "rotated_rect"
      readonly geometryId: string
      readonly layer: LayerName
      readonly centerX: number
      readonly centerY: number
      readonly widthMm: number
      readonly heightMm: number
      readonly rotationDegrees: number
    }

export type HybridCoreSearchRequest = {
  readonly protocolVersion: typeof HYBRID_ROUTING_CORE_PROTOCOL_VERSION
  readonly regionId: string
  readonly bounds: HybridBoardBounds
  readonly activeBounds: HybridBoardBounds
  readonly activationBounds: readonly HybridBoardBounds[]
  readonly layerNames: readonly LayerName[]
  readonly start: HybridCoreRoutePoint
  readonly goal: HybridCoreRoutePoint
  readonly legalViaSpans: readonly {
    readonly fromLayer: LayerName
    readonly toLayer: LayerName
  }[]
  readonly obstacles: readonly HybridCoreGeometry[]
  readonly resolutionMm: number
  readonly traceWidthMm: number
  readonly clearanceMm: number
  readonly viaPadDiameterMm: number
  readonly maximumVias: number
  readonly maximumExpansions: number
  readonly deterministicSeed: number
}

export type HybridCoreWorkCounters = {
  readonly searchExpansions: number
  readonly spatialIndexQueries: number
  readonly geometryPredicateCalls: number
  readonly generatedNeighbors: number
  readonly peakOpenSetSize: number
  readonly activatedRings: number
}

export type HybridCoreSearchResponse =
  | {
      readonly status: "solved"
      readonly protocolVersion: typeof HYBRID_ROUTING_CORE_PROTOCOL_VERSION
      readonly regionId: string
      readonly route: readonly HybridCoreRoutePoint[]
      readonly vias: readonly {
        readonly x: number
        readonly y: number
        readonly fromLayer: LayerName
        readonly toLayer: LayerName
      }[]
      readonly cost: {
        readonly viaCount: number
        readonly totalLengthMm: number
        readonly bendCount: number
      }
      readonly work: HybridCoreWorkCounters
    }
  | {
      readonly status: "failed"
      readonly protocolVersion: typeof HYBRID_ROUTING_CORE_PROTOCOL_VERSION
      readonly regionId: string
      readonly code: "search_budget_exhausted" | "no_legal_path"
      readonly message: string
      readonly work: HybridCoreWorkCounters
    }

export type HybridRoutingCoreRuntime = {
  readonly target: "native" | "wasm"
  execute(request: HybridCoreSearchRequest): Promise<HybridCoreSearchResponse>
}
