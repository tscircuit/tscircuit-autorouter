import type {
  HybridCoreSearchRequest,
  HybridCoreSearchResponse,
  HybridCoreWorkCounters,
  HybridRoutingCoreRuntime,
} from "./rust-core-protocol"
import type { HybridBoardBounds } from "./types"

export type MultiResolutionStrategy =
  | "direct_bounded"
  | "same_layer"
  | "full_compatible"

export type MultiResolutionSearchPlanEntry = {
  readonly resolutionLevel: "coarse" | "medium" | "fine"
  readonly resolutionMm: number
  readonly ringIndex: number
  readonly activeBounds: HybridBoardBounds
  readonly strategy: MultiResolutionStrategy
}

export type MultiResolutionSearchMetrics = {
  readonly candidatesConstructed: number
  readonly candidatesStepped: number
  readonly activeRings: number
  readonly solverStateRebuilds: number
  readonly rebuildReasons: readonly string[]
  readonly work: HybridCoreWorkCounters
}

export type MultiResolutionSearchResult =
  | {
      readonly status: "solved"
      readonly response: Extract<HybridCoreSearchResponse, { status: "solved" }>
      readonly metrics: MultiResolutionSearchMetrics
    }
  | {
      readonly status: "failed"
      readonly response: Extract<HybridCoreSearchResponse, { status: "failed" }>
      readonly metrics: MultiResolutionSearchMetrics
    }

export function createMultiResolutionSearchPlan({
  baseRequest,
  maximumActivationRings,
}: {
  baseRequest: HybridCoreSearchRequest
  maximumActivationRings: number
}): readonly MultiResolutionSearchPlanEntry[] {
  if (!Number.isSafeInteger(maximumActivationRings) || maximumActivationRings <= 0) {
    throw new Error("maximumActivationRings must be a positive safe integer")
  }
  const resolutions = getResolutionLevels(baseRequest.resolutionMm)
  const ringStepMm = Math.max(
    baseRequest.viaPadDiameterMm + 2 * baseRequest.clearanceMm,
    baseRequest.resolutionMm * 4,
  )
  const initialReserveMm = Math.max(
    ringStepMm,
    baseRequest.traceWidthMm + 2 * baseRequest.clearanceMm,
  )
  const entries: MultiResolutionSearchPlanEntry[] = []
  for (const resolution of resolutions) {
    for (let ringIndex = 0; ringIndex < maximumActivationRings; ringIndex++) {
      const activeBounds = getActiveBounds({
        request: baseRequest,
        reserveMm: initialReserveMm + ringIndex * ringStepMm,
      })
      for (const strategy of [
        "direct_bounded",
        "same_layer",
        "full_compatible",
      ] as const) {
        entries.push(
          Object.freeze({
            resolutionLevel: resolution.level,
            resolutionMm: resolution.resolutionMm,
            ringIndex,
            activeBounds,
            strategy,
          }),
        )
      }
      if (sameBounds(activeBounds, baseRequest.bounds)) break
    }
  }
  return Object.freeze(entries)
}

export async function runMultiResolutionSearch({
  runtime,
  baseRequest,
  maximumActivationRings,
}: {
  runtime: HybridRoutingCoreRuntime
  baseRequest: HybridCoreSearchRequest
  maximumActivationRings: number
}): Promise<MultiResolutionSearchResult> {
  const plan = createMultiResolutionSearchPlan({
    baseRequest,
    maximumActivationRings,
  })
  const resolutionLevels = ["coarse", "medium", "fine"] as const
  let candidatesConstructed = 0
  let candidatesStepped = 0
  let activeRings = 0
  let solverStateRebuilds = 0
  const rebuildReasons: string[] = []
  const work: HybridCoreWorkCounters = {
    searchExpansions: 0,
    spatialIndexQueries: 0,
    geometryPredicateCalls: 0,
    generatedNeighbors: 0,
    peakOpenSetSize: 0,
    activatedRings: 0,
  }
  let previousResolution: number | undefined
  let lastFailure: Extract<HybridCoreSearchResponse, { status: "failed" }> | undefined
  let lastSolved: Extract<HybridCoreSearchResponse, { status: "solved" }> | undefined
  let fineResolutionSolved = false
  for (const resolutionLevel of resolutionLevels) {
    const levelEntries = plan.filter(
      (entry) => entry.resolutionLevel === resolutionLevel,
    )
    if (levelEntries.length === 0) continue
    const resolution = levelEntries[0]!.resolutionMm
    if (previousResolution !== undefined && previousResolution !== resolution) {
      solverStateRebuilds += 1
      rebuildReasons.push(
        `grid resolution changed from ${previousResolution}mm to ${resolution}mm; frontier costs are not reusable across grids`,
      )
    }
    previousResolution = resolution
    let solvedAtLevel: Extract<HybridCoreSearchResponse, { status: "solved" }> | undefined
    for (const strategy of [
      "direct_bounded",
      "same_layer",
      "full_compatible",
    ] as const) {
      const strategyEntries = levelEntries.filter(
        (entry) => entry.strategy === strategy,
      )
      const firstEntry = strategyEntries[0]
      if (!firstEntry) continue
      candidatesConstructed += 1
      const response = await runtime.execute(
        createStrategyRequest({
          baseRequest,
          entry: firstEntry,
          activationBounds: strategyEntries
            .slice(1)
            .map((entry) => entry.activeBounds),
        }),
      )
      candidatesStepped += 1
      activeRings += response.work.activatedRings + 1
      accumulateWork({ cumulative: work, current: response.work })
      if (response.status === "solved") {
        solvedAtLevel = response
        lastSolved = response
        fineResolutionSolved = resolutionLevel === "fine"
        break
      }
      lastFailure = response
    }
    if (!solvedAtLevel) {
      if (!lastFailure) {
        throw new Error("multi-resolution search ended without a core result")
      }
      continue
    }
  }
  if (!lastSolved || !fineResolutionSolved) {
    if (lastFailure) {
      return Object.freeze({
        status: "failed",
        response: lastFailure,
        metrics: freezeMetrics({
          candidatesConstructed,
          candidatesStepped,
          activeRings,
          solverStateRebuilds,
          rebuildReasons,
          work,
        }),
      })
    }
    throw new Error("multi-resolution search produced no fine candidate")
  }
  return Object.freeze({
    status: "solved",
    response: lastSolved,
    metrics: freezeMetrics({
      candidatesConstructed,
      candidatesStepped,
      activeRings,
      solverStateRebuilds,
      rebuildReasons,
      work,
    }),
  })
}

function createStrategyRequest({
  baseRequest,
  entry,
  activationBounds,
}: {
  baseRequest: HybridCoreSearchRequest
  entry: MultiResolutionSearchPlanEntry
  activationBounds: readonly HybridBoardBounds[]
}): HybridCoreSearchRequest {
  return Object.freeze({
    ...baseRequest,
    regionId: `${baseRequest.regionId}:${entry.resolutionLevel}:${entry.ringIndex}:${entry.strategy}`,
    activeBounds: entry.activeBounds,
    activationBounds: Object.freeze([...activationBounds]),
    resolutionMm: entry.resolutionMm,
    maximumVias:
      entry.strategy === "same_layer" ? 0 : baseRequest.maximumVias,
    maximumExpansions:
      entry.strategy === "direct_bounded"
        ? Math.min(baseRequest.maximumExpansions, 256)
        : baseRequest.maximumExpansions,
  })
}

function getResolutionLevels(finalResolutionMm: number): readonly {
  level: MultiResolutionSearchPlanEntry["resolutionLevel"]
  resolutionMm: number
}[] {
  return Object.freeze([
    { level: "coarse", resolutionMm: finalResolutionMm * 4 },
    { level: "medium", resolutionMm: finalResolutionMm * 2 },
    { level: "fine", resolutionMm: finalResolutionMm },
  ])
}

function getActiveBounds({
  request,
  reserveMm,
}: {
  request: HybridCoreSearchRequest
  reserveMm: number
}): HybridBoardBounds {
  return Object.freeze({
    minX: Math.max(
      request.bounds.minX,
      Math.min(request.start.x, request.goal.x) - reserveMm,
    ),
    maxX: Math.min(
      request.bounds.maxX,
      Math.max(request.start.x, request.goal.x) + reserveMm,
    ),
    minY: Math.max(
      request.bounds.minY,
      Math.min(request.start.y, request.goal.y) - reserveMm,
    ),
    maxY: Math.min(
      request.bounds.maxY,
      Math.max(request.start.y, request.goal.y) + reserveMm,
    ),
  })
}

function accumulateWork({
  cumulative,
  current,
}: {
  cumulative: {
    searchExpansions: number
    spatialIndexQueries: number
    geometryPredicateCalls: number
    generatedNeighbors: number
    peakOpenSetSize: number
    activatedRings: number
  }
  current: HybridCoreWorkCounters
}): void {
  cumulative.searchExpansions += current.searchExpansions
  cumulative.spatialIndexQueries += current.spatialIndexQueries
  cumulative.geometryPredicateCalls += current.geometryPredicateCalls
  cumulative.generatedNeighbors += current.generatedNeighbors
  cumulative.peakOpenSetSize = Math.max(
    cumulative.peakOpenSetSize,
    current.peakOpenSetSize,
  )
  cumulative.activatedRings += current.activatedRings
}

function freezeMetrics({
  candidatesConstructed,
  candidatesStepped,
  activeRings,
  solverStateRebuilds,
  rebuildReasons,
  work,
}: MultiResolutionSearchMetrics): MultiResolutionSearchMetrics {
  return Object.freeze({
    candidatesConstructed,
    candidatesStepped,
    activeRings,
    solverStateRebuilds,
    rebuildReasons: Object.freeze([...rebuildReasons]),
    work: Object.freeze({ ...work }),
  })
}

function sameBounds(
  first: HybridBoardBounds,
  second: HybridBoardBounds,
): boolean {
  return (
    first.minX === second.minX &&
    first.maxX === second.maxX &&
    first.minY === second.minY &&
    first.maxY === second.maxY
  )
}
