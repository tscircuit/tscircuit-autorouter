import type {
  DynamicRoutingRegion,
  GlobalRouteObjectPlan,
  HybridBoundaryContract,
} from "./planning-types"
import type { HybridTransactionDelta } from "./transactional-copper-types"
import type { HybridRouterDiagnostic, TypedRoutingProblem } from "./types"
import type { RegionJob } from "./worker-protocol"

export const HYBRID_REGION_SOLVER_VERSION = "hybrid-regional-core-0.1.0"

export type RegionCacheKey = string

export type CachedRegionCandidate = {
  readonly key: RegionCacheKey
  readonly transactionDelta: HybridTransactionDelta
  readonly diagnostic: HybridRouterDiagnostic
  readonly storedBytes: number
}

export type RegionCacheSnapshot = {
  readonly entryCount: number
  readonly storedBytes: number
  readonly hits: number
  readonly misses: number
  readonly evictions: number
  readonly invalidations: number
  readonly validationMs: number
}

type StoredRegionCandidate = CachedRegionCandidate

export class ContentAddressedRegionCache {
  private readonly maximumEntryCount: number
  private readonly maximumStoredBytes: number
  private readonly entries = new Map<RegionCacheKey, StoredRegionCandidate>()
  private storedBytes = 0
  private hits = 0
  private misses = 0
  private evictions = 0
  private invalidations = 0
  private validationMs = 0

  constructor({
    maximumEntryCount,
    maximumStoredBytes,
  }: {
    maximumEntryCount: number
    maximumStoredBytes: number
  }) {
    requirePositiveSafeInteger(maximumEntryCount, "maximumEntryCount")
    requirePositiveSafeInteger(maximumStoredBytes, "maximumStoredBytes")
    this.maximumEntryCount = maximumEntryCount
    this.maximumStoredBytes = maximumStoredBytes
  }

  get(key: RegionCacheKey): CachedRegionCandidate | undefined {
    const entry = this.entries.get(key)
    if (!entry) {
      this.misses = incrementBoundedCounter(this.misses)
      return undefined
    }
    this.hits = incrementBoundedCounter(this.hits)
    this.entries.delete(key)
    this.entries.set(key, entry)
    return entry
  }

  put({
    key,
    transactionDelta,
    diagnostic,
  }: {
    key: RegionCacheKey
    transactionDelta: HybridTransactionDelta
    diagnostic: HybridRouterDiagnostic
  }): boolean {
    const storedBytes = utf8ByteLength(
      canonicalJson({ key, transactionDelta, diagnostic }),
    )
    if (storedBytes > this.maximumStoredBytes) return false
    const existing = this.entries.get(key)
    if (existing) {
      this.entries.delete(key)
      this.storedBytes -= existing.storedBytes
    }
    while (
      this.entries.size >= this.maximumEntryCount ||
      this.storedBytes + storedBytes > this.maximumStoredBytes
    ) {
      const oldestKey = this.entries.keys().next().value
      if (typeof oldestKey !== "string") break
      const oldest = this.entries.get(oldestKey)
      this.entries.delete(oldestKey)
      if (oldest) this.storedBytes -= oldest.storedBytes
      this.evictions = incrementBoundedCounter(this.evictions)
    }
    const entry = Object.freeze({
      key,
      transactionDelta,
      diagnostic,
      storedBytes,
    })
    this.entries.set(key, entry)
    this.storedBytes += storedBytes
    return true
  }

  invalidate(key: RegionCacheKey): boolean {
    const entry = this.entries.get(key)
    if (!entry) return false
    this.entries.delete(key)
    this.storedBytes -= entry.storedBytes
    this.invalidations = incrementBoundedCounter(this.invalidations)
    return true
  }

  recordValidationMs(durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) {
      throw new Error("cache validation duration must be finite and non-negative")
    }
    this.validationMs = Math.min(
      Number.MAX_SAFE_INTEGER,
      this.validationMs + durationMs,
    )
  }

  getSnapshot(): RegionCacheSnapshot {
    return Object.freeze({
      entryCount: this.entries.size,
      storedBytes: this.storedBytes,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      invalidations: this.invalidations,
      validationMs: this.validationMs,
    })
  }
}

export function createRegionCacheKey({
  problem,
  region,
  routePlan,
  boundaryContracts,
  job,
  runtimeTarget,
}: {
  problem: TypedRoutingProblem
  region: DynamicRoutingRegion
  routePlan: GlobalRouteObjectPlan
  boundaryContracts: readonly HybridBoundaryContract[]
  job: RegionJob
  runtimeTarget: "native" | "wasm"
}): RegionCacheKey {
  const matchingContracts = boundaryContracts
    .filter((contract) =>
      job.boundaryContractReferences.includes(contract.contractId),
    )
    .sort((first, second) => first.contractId.localeCompare(second.contractId))
  const connections = routePlan.connectionNames.map((connectionName) => {
    const connection = problem.compiledRules.connections.find(
      (candidate) => candidate.connectionName === connectionName,
    )
    if (!connection) {
      throw new Error(
        `cannot construct cache key for unknown connection ${connectionName}`,
      )
    }
    return Object.freeze({
      connectionName,
      terminals: connection.terminals,
    })
  })
  const immutableCopperVersion = stableContentHash(
    canonicalJson(
      problem.compiledRules.preloadedCopper
        .filter((copper) => copper.mutability === "immutable")
        .map((copper) => copper.trace),
    ),
  )
  const regionGeometryHash = stableContentHash(
    canonicalJson({
      bounds: region.bounds,
      maximumEnvelope: region.maximumEnvelope,
      overlapReserveMm: region.overlapReserveMm,
      corridors: routePlan.corridors,
    }),
  )
  const compiledRuleHash = stableContentHash(
    canonicalJson(problem.compiledRules),
  )
  return `hybrid-region:${stableContentHash(
    canonicalJson({
      regionGeometryHash,
      compiledRuleHash,
      terminalIdentities: connections,
      boundaryContracts: matchingContracts,
      immutableCopperVersion,
      layerStack: problem.compiledRules.layerStack,
      solverVersion: HYBRID_REGION_SOLVER_VERSION,
      workerProtocolVersion: job.protocolVersion,
      runtimeTarget,
      deterministicConfiguration: {
        deterministicSeed: job.deterministicSeed,
        solverBudget: job.solverBudget,
        routingResolutionMm: job.routingResolutionMm,
        coupling: job.coupling,
      },
      routeObjectId: routePlan.routeObjectId,
      ownedPreloadedCopperReferences: job.ownedPreloadedCopperReferences,
    }),
  )}`
}

export function getRegionCacheRunSnapshot({
  initial,
  current,
}: {
  initial: RegionCacheSnapshot
  current: RegionCacheSnapshot
}): RegionCacheSnapshot {
  return Object.freeze({
    entryCount: current.entryCount,
    storedBytes: current.storedBytes,
    hits: Math.max(0, current.hits - initial.hits),
    misses: Math.max(0, current.misses - initial.misses),
    evictions: Math.max(0, current.evictions - initial.evictions),
    invalidations: Math.max(
      0,
      current.invalidations - initial.invalidations,
    ),
    validationMs: Math.max(0, current.validationMs - initial.validationMs),
  })
}

export const EMPTY_REGION_CACHE_SNAPSHOT: RegionCacheSnapshot = Object.freeze({
  entryCount: 0,
  storedBytes: 0,
  hits: 0,
  misses: 0,
  evictions: 0,
  invalidations: 0,
  validationMs: 0,
})

function requirePositiveSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive safe integer`)
  }
}

function incrementBoundedCounter(value: number): number {
  return Math.min(Number.MAX_SAFE_INTEGER, value + 1)
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function stableContentHash(value: string): string {
  let firstHash = 2166136261
  let secondHash = 2246822519
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    firstHash = Math.imul(firstHash ^ code, 16777619)
    secondHash = Math.imul(secondHash ^ code, 3266489917)
  }
  return `${(firstHash >>> 0).toString(16).padStart(8, "0")}${(
    secondHash >>> 0
  )
    .toString(16)
    .padStart(8, "0")}`
}

function canonicalJson(value: unknown): string {
  const encoded = encodeCanonicalValue(value, false)
  if (encoded === undefined) {
    throw new Error("value cannot be represented as canonical JSON")
  }
  return encoded
}

function encodeCanonicalValue(
  value: unknown,
  insideArray: boolean,
): string | undefined {
  if (value === null) return "null"
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value)
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("canonical JSON requires finite numbers")
    }
    return JSON.stringify(value)
  }
  if (
    typeof value === "undefined" ||
    typeof value === "function" ||
    typeof value === "symbol"
  ) {
    return insideArray ? "null" : undefined
  }
  if (typeof value === "bigint") {
    throw new Error("canonical JSON does not support bigint values")
  }
  if (Array.isArray(value)) {
    return `[${value
      .map((item) => encodeCanonicalValue(item, true) ?? "null")
      .join(",")}]`
  }
  const properties = Object.entries(value)
    .sort(([firstKey], [secondKey]) => firstKey.localeCompare(secondKey))
    .flatMap(([key, propertyValue]) => {
      const encodedProperty = encodeCanonicalValue(propertyValue, false)
      return encodedProperty === undefined
        ? []
        : [`${JSON.stringify(key)}:${encodedProperty}`]
    })
  return `{${properties.join(",")}}`
}
