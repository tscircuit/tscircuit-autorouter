import { OBSERVER_SYMBOL } from "./instrument-core2392.mjs"

const LIMITS = Object.freeze({ tracePoints: 128, traces: 8, normalizations: 16, visibilityInspections: 64, nullReasons: 12, sourceMatches: 8, objectKeys: 32 })
const own = (object, key) => object == null ? undefined : Object.getOwnPropertyDescriptor(object, key)?.value
const arrayValues = array => Array.isArray(array) ? Array.from({ length: own(array, "length") }, (_, i) => own(array, String(i))) : []

/** Snapshot only data descriptors: diagnostic reads never invoke user getters. */
function copy(value, depth = 5, seen = new WeakSet()) {
  if (typeof value === "number" && !Number.isFinite(value)) return { nonfinite: String(value) }
  if (value === undefined) return { absent: true }
  if (value === null || typeof value !== "object") return typeof value === "function" ? { functionOmitted: true } : value
  if (depth <= 0) return { depthLimit: true }
  if (seen.has(value)) return { repeatedObject: true }
  seen.add(value)
  if (Array.isArray(value)) {
    const length = own(value, "length")
    const result = { values: arrayValues(value).slice(0, LIMITS.tracePoints).map(v => copy(v, depth - 1, seen)), totalCount: length, truncated: length > LIMITS.tracePoints }
    seen.delete(value)
    return result
  }
  const result = {}
  const keys = Object.getOwnPropertyNames(value)
  for (const key of keys.slice(0, LIMITS.objectKeys)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    result[key] = descriptor && "value" in descriptor ? copy(descriptor.value, depth - 1, seen) : { accessorOmitted: true }
  }
  if (keys.length > LIMITS.objectKeys) result.omittedKeyCount = keys.length - LIMITS.objectKeys
  seen.delete(value)
  return result
}
const fields = (object, keys) => Object.fromEntries(keys.map(key => [key, copy(own(object, key))]))
const PIPELINE_FIELDS = ["phase", "iterations", "MAX_ITERATIONS", "progress", "solved", "failed", "error", "failureCode", "attempt", "routingDeadline", "stats", "options", "carrierStrategy", "canNegotiateGeneratedSites"]
const CHILD_FIELDS = ["phase", "iterations", "MAX_ITERATIONS", "progress", "solved", "failed", "error", "failureCode", "attempt", "lane", "pairIndex", "pairVariant", "congestionPass", "conflictingLanes", "isRefinement", "stats", "reportedRoutes", "lengthStats"]

export function createBus58SurfaceObserver({ isActive = () => true } = {}) {
  const contexts = new WeakMap()
  const ids = new WeakMap()
  let nextId = 1
  let normalizationCount = 0
  let visibilityInspections = 0
  let enabled = true
  const report = {
    schemaVersion: 1, observerSymbol: OBSERVER_SYMBOL, limits: LIMITS,
    instrumentedBaseline: true, observerError: null, counts: {},
    surfaceStarts: [], surfaceNulls: [], normalizationSummaries: [],
    firstJoinedRejection: null, firstRejectedNormalizationCandidate: null,
    firstVisibilityBlock: null, firstPotentialSupersededBlock: null, firstVisibilityBoundary: null,
    firstSurfaceNull: null, firstCompletedNull: null,
    predicateReevaluationByObserver: false,
    provenanceCaveat: "Original-with-replacement is potential superseded provenance, not proof of stale physical copper; equivalent, subdivided or supplied copper can remain live.",
    wallClockCaveat: "Routing budgets are unchanged; observer work can consume elapsed-time budget.",
  }
  const id = object => {
    if (object === null || typeof object !== "object") return null
    if (!ids.has(object)) ids.set(object, nextId++)
    return ids.get(object)
  }
  const trace = (object, routeOverride) => ({ objectId: id(object), ...fields(object, ["pcb_trace_id", "connection_name", "source_trace_id", "curvedSegments", "coupledSection"]), route: copy(routeOverride ?? own(object, "route")) })
  const traces = values => ({ totalCount: arrayValues(values).length, values: arrayValues(values).slice(0, LIMITS.traces).map(v => trace(v)), truncated: arrayValues(values).length > LIMITS.traces })
  const pipeline = object => ({ ...fields(object, PIPELINE_FIELDS), child: fields(own(object, "child"), CHILD_FIELDS), traces: traces(own(object, "traces")), escapes: traces(own(object, "escapes")), completedLaneCount: arrayValues(own(object, "completedLanes")).length, acceptedTracesPresent: own(object, "acceptedTraces") !== undefined })
  const getContext = context => contexts.get(context)
  const candidate = context => {
    const current = own(context, "candidate")
    return { kind: own(current, "kind"), atStart: own(current, "atStart"), original: trace(own(current, "original")), proposed: trace(own(current, "trace") ?? own(current, "original"), own(current, "candidateRoute")), visibilityRoute: copy(own(current, "visibilityRoute")) }
  }
  const matchesPrimitive = (route, copper) => {
    const points = arrayValues(route)
    return points.includes(own(copper, "a")) && points.includes(own(copper, "b"))
  }
  const sourcePacket = (source, state) => {
    const original = own(source, "original")
    const replacement = state.replacements.get(original)
    return { kind: own(source, "kind"), originalObjectId: id(original), replacementObserved: replacement !== undefined, original: original ? trace(original) : null, replacement: replacement ? trace(replacement) : null }
  }
  const block = details => {
    const context = own(details, "context"), state = getContext(context), copper = own(details, "copper")
    if (!state) return null
    const sources = state.copperSources.get(copper) ?? []
    const input = own(context, "input")
    // These are actual references from the input, not reconstructed routeCopper.
    const inputMatches = []
    for (const [index, object] of arrayValues(own(input, "obstacles")).entries()) {
      if (own(copper, "a") === own(object, "center") && own(copper, "b") === own(object, "center")) inputMatches.push({ kind: "input_obstacle_center_identity", index, objectId: id(object), obstacle: copy(object) })
      if (inputMatches.length >= LIMITS.sourceMatches) break
    }
    for (const [index, object] of arrayValues(own(input, "traces")).entries()) {
      if (matchesPrimitive(own(object, "route"), copper)) inputMatches.push({ kind: "input_trace_endpoint_identities", index, objectId: id(object), isGeneratedEscapeObject: state.generatedEscapes.includes(object), original: trace(object), replacement: state.replacements.has(object) ? trace(state.replacements.get(object)) : null })
      if (inputMatches.length >= LIMITS.sourceMatches) break
    }
    const potential = sources.some(source => own(source, "kind") === "original_carrier" && state.replacements.has(own(source, "original"))) || inputMatches.some(match => match.isGeneratedEscapeObject && match.replacement)
    return {
      normalizationId: state.id, candidate: candidate(context),
      query: fields(details, ["a", "b", "margin"]), copperObjectId: id(copper), copper: copy(copper),
      scene: fields(own(details, "scene"), ["width", "margin", "connection"]),
      actualPrimitiveSources: sources.slice(0, LIMITS.sourceMatches).map(source => sourcePacket(source, state)),
      inputIdentityMatches: inputMatches,
      provenance: potential ? "original_with_observed_replacement_potentially_superseded" : sources.length ? "actual_primitive_origin_recorded" : "unknown_or_shared_origin",
      physicalStalenessProved: false,
    }
  }

  const observe = (event, details) => {
    if (!enabled) return
    try {
      if (!isActive()) return
      report.counts[event] = (report.counts[event] ?? 0) + 1
      const context = own(details, "context")
      if (event === "normalization_start") {
        normalizationCount++
        if (normalizationCount > LIMITS.normalizations) return
        const summary = { id: normalizationCount, carrierCount: arrayValues(own(context, "traces")).length, escapeCount: arrayValues(own(context, "generatedEscapes")).length, candidates: 0, rejectedCandidates: 0, originalCarrierPrimitiveCount: 0, inputPrimitiveCount: 0, replacementPrimitiveCount: 0 }
        report.normalizationSummaries.push(summary)
        contexts.set(context, { id: normalizationCount, summary, copperSources: new WeakMap(), replacements: new Map(), generatedEscapes: arrayValues(own(context, "generatedEscapes")) })
      } else if (event === "normalization_copper") {
        const state = getContext(context)
        if (!state) return
        const kind = own(details, "kind"), copper = arrayValues(own(details, "copper"))
        const countKey = kind === "input_copper" ? "inputPrimitiveCount" : kind === "original_carrier" ? "originalCarrierPrimitiveCount" : "replacementPrimitiveCount"
        state.summary[countKey] += copper.length
        for (const primitive of copper) {
          const sources = state.copperSources.get(primitive) ?? []
          sources.push({ kind, original: own(details, "original"), replacement: own(details, "replacement") })
          state.copperSources.set(primitive, sources)
        }
      } else if (event === "carrier_replaced" || event === "escape_replaced") {
        const state = getContext(context), original = own(details, "original"), replacement = own(details, "replacement")
        if (state && original !== replacement) state.replacements.set(original, replacement)
      } else if (event === "escape_replacement_map") {
        const state = getContext(context), replacements = own(details, "replacements")
        if (state && replacements instanceof Map) for (const [original, replacement] of Map.prototype.entries.call(replacements)) if (original !== replacement) state.replacements.set(original, replacement)
      } else if (event === "normalization_candidate") {
        const state = getContext(context)
        if (!state) return
        state.summary.candidates++
        if (own(details, "accepted") === false) {
          state.summary.rejectedCandidates++
          if (!report.firstRejectedNormalizationCandidate) report.firstRejectedNormalizationCandidate = { normalizationId: state.id, candidate: candidate(context), results: fields(details, ["monotone", "octilinear", "angles", "selfClear", "originalSelfClear", "visible", "accepted"]) }
        }
      } else if (event === "visibility_blocked") {
        if (visibilityInspections >= LIMITS.visibilityInspections || report.firstPotentialSupersededBlock) return
        const state = getContext(context)
        if (!state) return
        if (report.firstVisibilityBlock && state.replacements.size === 0) return
        visibilityInspections++
        const packet = block(details)
        if (!report.firstVisibilityBlock) report.firstVisibilityBlock = packet
        if (packet?.provenance === "original_with_observed_replacement_potentially_superseded") report.firstPotentialSupersededBlock = packet
      } else if (event === "visibility_boundary" && !report.firstVisibilityBoundary) {
        const scene = own(details, "scene")
        report.firstVisibilityBoundary = { reason: own(details, "reason"), candidate: candidate(context), query: fields(details, ["a", "b"]), scene: fields(scene, ["width", "margin", "connection"]), input: fields(own(scene, "input"), ["bounds", "outline"]) }
      } else if (event === "joined_rejected" && !report.firstJoinedRejection) {
        report.firstJoinedRejection = { reason: own(details, "reason"), trace: trace(own(details, "trace")), run: copy(own(details, "run")), input: fields(own(details, "input"), ["bounds", "outline", "minTraceWidth", "minTraceToPadEdgeClearance", "defaultObstacleMargin"]), clearance: copy(own(details, "clearance")) }
      } else if (event === "surface_start" && report.surfaceStarts.length < 4) {
        report.surfaceStarts.push({ entry: own(details, "entry"), pipeline: pipeline(own(details, "pipeline")) })
      } else if (event === "surface_null") {
        const reason = own(details, "reason")
        if (report.surfaceNulls.length < LIMITS.nullReasons) report.surfaceNulls.push({ reason, validator: fields(own(details, "validator"), CHILD_FIELDS), steps: copy(own(details, "steps")), error: copy(own(details, "error")) })
        if (!report.firstSurfaceNull) {
          const prepared = own(details, "prepared")
          report.firstSurfaceNull = { reason, error: copy(own(details, "error")), options: copy(own(details, "options")), policy: copy(own(details, "policy")), maxSteps: copy(own(details, "maxSteps")), carriers: traces(own(prepared, "traces") ?? own(details, "carriers")), escapes: traces(own(prepared, "escapes") ?? own(details, "escapes")), validator: fields(own(details, "validator"), CHILD_FIELDS) }
        }
      } else if (event === "surface_done" && !report.firstCompletedNull && own(own(details, "state"), "value") === null) {
        report.firstCompletedNull = pipeline(own(details, "pipeline"))
      }
    } catch (error) {
      report.observerError = { event, error: copy(error) }
      enabled = false
    }
  }
  return {
    observe,
    install() { globalThis[Symbol.for(OBSERVER_SYMBOL)] = observe },
    getReport() { return { ...report, normalizationCount, normalizationLimitReached: normalizationCount > LIMITS.normalizations, visibilityInspections, visibilityInspectionLimitReached: visibilityInspections >= LIMITS.visibilityInspections, observerCompletedWithoutError: report.observerError === null, observedSurfaceNull: report.firstSurfaceNull !== null, observedCompletedNull: report.firstCompletedNull !== null } },
  }
}
