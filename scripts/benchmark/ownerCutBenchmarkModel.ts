import { createHash } from "node:crypto"
import { findDistinctOwnerBlockerPath, type DistinctOwnerBlockerHop, type DistinctOwnerBlockerSearchResult } from "tiny-hypergraph/lib/find-distinct-owner-blocker-path"
import { findCutGuidedOwnerRelease, type OwnerCutResult } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/findCutGuidedOwnerRelease"

export type OwnerCutBenchmarkArm = "native" | "candidate"
export type OwnerCutBenchmarkState = { portId: number; nextRegionId: number }
export type OwnerCutBenchmarkHop = DistinctOwnerBlockerHop<OwnerCutBenchmarkState, number, unknown>
export type OwnerCutBenchmarkResult = DistinctOwnerBlockerSearchResult<OwnerCutBenchmarkState, number, unknown>
export type OwnerCutBenchmarkHost = {
  topology: unknown; problem: unknown; problemSetup: unknown
  candidateHopSlotStride: number
  candidateFirstRegionByPortId: Int32Array
  candidateSecondRegionByPortId: Int32Array
  state: {
    currentRouteId?: number; currentRouteNetId?: number
    portAssignment: Int32Array; regionSegments: unknown
  }
  getRouteStartPortId(route: number): number
  getRouteEndPortId(route: number): number
  getStartingNextRegionId(route: number, port: number): number | undefined
  getHopId(port: number, region: number): number
  getPortOwners(): ReadonlyMap<number, ReadonlySet<number>>
  getRelaxedSearchExpansionLimit(): number
  getRelaxedSearchHops(params: {
    state: OwnerCutBenchmarkState; goalPortId: number; routeNetId: number
    portOwners: ReadonlyMap<number, ReadonlySet<number>>
    portResources: Map<number, unknown>; hopTemplatesByRegion: Map<number, OwnerCutBenchmarkHop[]>
    forbiddenOwnerRouteIds: ReadonlySet<number>; buildRegionTemplates?: boolean
  }): OwnerCutBenchmarkHop[]
}
export type OwnerCutReferenceQuery = {
  index: number; routeId: number; forbiddenOwnerCount: number
  start: OwnerCutBenchmarkState; goalPortId: number
  native: { found: true; owners: number[]; distance: number; expandedLabelCount: number; states: OwnerCutBenchmarkState[] }
}
export type OwnerCutReferenceSample = {
  sample: number; expectedTotalNativeQueries: number; expectedTotalNativeExpanded: number
  queries: OwnerCutReferenceQuery[]
}
export type OwnerCutBenchmarkReference = {
  schema: number; base: string; kernelCommit: string; sources: unknown[]
  samples: OwnerCutReferenceSample[]
}

/** Canonical provenance only. Never run this serializer inside an operator timer. */
export function ownerCutValueHash(value: unknown): string {
  const hash = createHash("sha256")
  const emit = (item: unknown): void => {
    if (typeof item === "number") {
      hash.update(Object.is(item, -0) ? "n:-0;" : `n:${item};`); return
    }
    if (item === undefined) { hash.update("u;"); return }
    if (item === null || typeof item === "string" || typeof item === "boolean") {
      hash.update(`${typeof item}:${JSON.stringify(item)};`); return
    }
    if (ArrayBuffer.isView(item)) {
      hash.update(`typed:${item.constructor.name}:${item.byteLength}:`)
      hash.update(new Uint8Array(item.buffer, item.byteOffset, item.byteLength)); return
    }
    if (item instanceof Map || item instanceof Set) {
      hash.update(item instanceof Map ? "map[" : "set[")
      for (const entry of item) emit(entry)
      hash.update("]"); return
    }
    if (Array.isArray(item)) {
      hash.update(`array:${item.length}:[`)
      for (const entry of item) emit(entry)
      hash.update("]"); return
    }
    if (typeof item !== "object") throw new Error("Unsupported owner-query provenance value")
    const object = item as Record<string, unknown>
    hash.update("object{")
    for (const key of Object.keys(object).sort()) { emit(key); emit(object[key]) }
    hash.update("}")
  }
  emit(value)
  return hash.digest("hex")
}

export function ownerCutQueryFingerprint(host: OwnerCutBenchmarkHost, forbidden: ReadonlySet<number>): string {
  return ownerCutValueHash({
    topology: host.topology, problem: host.problem, problemSetup: host.problemSetup,
    hopStride: host.candidateHopSlotStride,
    firstRegions: host.candidateFirstRegionByPortId, secondRegions: host.candidateSecondRegionByPortId,
    routeId: host.state.currentRouteId, netId: host.state.currentRouteNetId,
    assignments: host.state.portAssignment, committedSegments: host.state.regionSegments,
    forbidden: [...forbidden],
  })
}

/**
 * Same cold native adapter as findRelaxedBlockerPath: owner scan, start/goal,
 * resources, region templates and state-hop cache are fresh on EVERY call.
 * Both operators pay this setup and every hop they request. The candidate's
 * additional internal cache/SCC/master/distance work remains inside its call.
 * No graph adjacency is generated or shared before the selected call.
 */
export function runColdOwnerCutOperator(
  arm: OwnerCutBenchmarkArm, host: OwnerCutBenchmarkHost,
  forbidden: ReadonlySet<number>, maxCandidateWork: number,
): { result: OwnerCutBenchmarkResult; candidate?: OwnerCutResult<OwnerCutBenchmarkState, number, unknown> } {
  const route = host.state.currentRouteId, net = host.state.currentRouteNetId
  if (route === undefined || net === undefined) throw new Error("Missing immutable native owner-query context")
  const startPortId = host.getRouteStartPortId(route), goalPortId = host.getRouteEndPortId(route)
  const nextRegionId = host.getStartingNextRegionId(route, startPortId)
  if (nextRegionId === undefined) throw new Error("Missing native directed starting incidence")
  const portOwners = host.getPortOwners()
  const portResources = new Map<number, unknown>()
  const hopTemplatesByRegion = new Map<number, OwnerCutBenchmarkHop[]>()
  const hopsByState = new Map<number, OwnerCutBenchmarkHop[]>()
  const forbiddenOwnerRouteIds = forbidden
  const options = {
    start: { portId: startPortId, nextRegionId },
    getStateKey: (state: OwnerCutBenchmarkState): number => host.getHopId(state.portId, state.nextRegionId),
    isGoal: (state: OwnerCutBenchmarkState): boolean => state.portId === goalPortId,
    getHops: (state: OwnerCutBenchmarkState): OwnerCutBenchmarkHop[] => {
      const key = host.getHopId(state.portId, state.nextRegionId)
      const known = hopsByState.get(key)
      if (known) return known
      const hops = host.getRelaxedSearchHops({ state, goalPortId, routeNetId: net, portOwners,
        portResources, hopTemplatesByRegion, forbiddenOwnerRouteIds })
      hopsByState.set(key, hops)
      return hops
    },
  }
  if (arm === "native") return { result: findDistinctOwnerBlockerPath({ ...options,
    maxExpandedLabels: host.getRelaxedSearchExpansionLimit(), checkReachability: true }) }
  const candidate = findCutGuidedOwnerRelease({ ...options, maxWorkUnits: maxCandidateWork })
  return { result: candidate.result, candidate }
}

export function compareOwnerCutResults(native: OwnerCutBenchmarkResult, other: OwnerCutBenchmarkResult): {
  classification: "exact" | "objective-only" | "unknown" | "mismatch"
  sameObjective: boolean | null; sameOwners: boolean | null; sameStates: boolean | null; sameHops: boolean | null
} {
  if (!other.found && other.reason === "expansion_limit") return {
    classification: "unknown", sameObjective: null, sameOwners: null, sameStates: null, sameHops: null }
  if (native.found && other.found) {
    const sameObjective = native.owners.size === other.owners.size && Object.is(native.distance, other.distance)
    const sameOwners = ownerCutValueHash([...native.owners].sort((a, b): number => a - b)) === ownerCutValueHash([...other.owners].sort((a, b): number => a - b))
    const sameStates = ownerCutValueHash(native.states) === ownerCutValueHash(other.states)
    const sameHops = ownerCutValueHash(native.hops) === ownerCutValueHash(other.hops)
    return { classification: !sameObjective ? "mismatch" : sameOwners && sameStates && sameHops ? "exact" : "objective-only", sameObjective, sameOwners, sameStates, sameHops }
  }
  const exact = !native.found && !other.found && native.reason === other.reason
  return { classification: exact ? "exact" : "mismatch", sameObjective: exact, sameOwners: null, sameStates: null, sameHops: null }
}

export function assertOwnerCutReference(
  expected: OwnerCutReferenceQuery, host: OwnerCutBenchmarkHost,
  forbidden: ReadonlySet<number>, native: OwnerCutBenchmarkResult,
): void {
  const route = host.state.currentRouteId
  if (route !== expected.routeId || forbidden.size !== expected.forbiddenOwnerCount || !native.found) {
    throw new Error(`Native owner query ${expected.index} changed identity or feasibility`)
  }
  const startPort = host.getRouteStartPortId(route)
  const startRegion = host.getStartingNextRegionId(route, startPort)
  if (startPort !== expected.start.portId || startRegion !== expected.start.nextRegionId ||
    host.getRouteEndPortId(route) !== expected.goalPortId ||
    native.expandedLabelCount !== expected.native.expandedLabelCount ||
    !Object.is(native.distance, expected.native.distance) ||
    ownerCutValueHash(native.states) !== ownerCutValueHash(expected.native.states) ||
    ownerCutValueHash([...native.owners].sort((a, b): number => a - b)) !== ownerCutValueHash([...expected.native.owners].sort((a, b): number => a - b))) {
    throw new Error(`Native owner query ${expected.index} differs from the captured directed witness`)
  }
}
