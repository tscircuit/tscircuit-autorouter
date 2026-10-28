import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { runAllRoutingChecks, checkCopperToBoardEdgeClearance, checkViasOffBoard } from "@tscircuit/checks"
import { evaluateRelaxedDrc, combinePreloadedAndRoutedTraces } from "../../lib/testing/evaluate-relaxed-drc"

const directory = process.argv[2]
if (!directory) throw new Error("Raw output directory is required")
const readJson = (name: string): any => JSON.parse(readFileSync(resolve(directory, name), "utf8"))
const original = readJson("original-input.json")
const pointPairs = readJson("point-pair-context.json")
const traces = readJson("raw-new-traces.json")
const capture = readJson("capture-provenance.json")

function errorRecord(error: any): Record<string, unknown> {
  return Object.fromEntries(Object.entries(error).filter(([key, value]) =>
    key === "type" || key === "message" || key === "center" || key === "pcb_center" ||
    ((key.endsWith("_id") || key.endsWith("_ids")) && !key.endsWith("error_id")) ||
    (typeof value === "number" && ["x", "y"].includes(key)),
  ))
}

function summarizeErrors(errors: any[]): Record<string, unknown> {
  const byType: Record<string, number> = {}
  for (const error of errors) {
    const type = String(error.type ?? "unknown")
    byType[type] = (byType[type] ?? 0) + 1
  }
  return { count: errors.length, byType, errors: errors.map(errorRecord) }
}

function physicalCopperMetrics(circuitJson: any[]): Record<string, unknown> {
  const combined = combinePreloadedAndRoutedTraces(original.traces ?? [], traces)
  // Metrics must not merge foreign owners through the inherited coordinate-
  // rounded connectivity helper. Use declared net/root identities only.
  const declaredOwners = new Map<string, string>()
  const ambiguousOwners = new Set<string>()
  for (const connection of [...original.connections, ...pointPairs.connections]) {
    const owner = connection.__netConnectionName ?? connection.netConnectionName ?? connection.rootConnectionName ?? connection.__rootConnectionNames?.[0] ?? connection.name
    for (const alias of [connection.name, connection.source_trace_id, ...(connection.__rootConnectionNames ?? []), ...(connection.mergedConnectionNames ?? [])].filter(Boolean)) {
      if (declaredOwners.has(alias) && declaredOwners.get(alias) !== owner) ambiguousOwners.add(alias)
      else declaredOwners.set(alias, owner)
    }
  }
  const declaredOwner = (name: string): string => ambiguousOwners.has(name) ? `ambiguous:${name}` : declaredOwners.get(name) ?? name
  const sites = new Set<string>()
  const coordinateOwners = new Map<string, Set<string>>()
  const segments = new Map<string, number>()
  let routeViaCount = 0
  let routePointCount = 0
  let copperLength = 0
  const ownersByTraceId = new Map<string, string>()
  for (const trace of combined) {
    const owner = declaredOwner(trace.connection_name)
    ownersByTraceId.set(trace.pcb_trace_id, owner)
    routePointCount += trace.route.length
    for (let index = 0; index < trace.route.length; index++) {
      const point = trace.route[index]
      if (point.route_type === "via") {
        routeViaCount++
      }
      const next = trace.route[index + 1]
      if (point.route_type !== "wire" || next?.route_type !== "wire" || point.layer !== next.layer) continue
      const length = Math.hypot(next.x - point.x, next.y - point.y)
      copperLength += length
      const ends = [[point.x, point.y, point.width], [next.x, next.y, next.width]].sort((a, b) => a[0] - b[0] || a[1] - b[1])
      segments.set(JSON.stringify([owner, point.layer, ends]), length)
    }
  }
  // The pinned converter materializes physical drill spans (full stack by
  // default), rather than confusing route layer transitions with via barrels.
  for (const via of circuitJson.filter((element) => element.type === "pcb_via")) {
    const owner = ownersByTraceId.get(via.pcb_trace_id) ?? declaredOwner(via.source_trace_id ?? via.pcb_trace_id)
    const layers = [...via.layers].sort()
    const site = JSON.stringify([via.x, via.y, layers])
    sites.add(JSON.stringify([owner, via.x, via.y, layers]))
    if (!coordinateOwners.has(site)) coordinateOwners.set(site, new Set())
    coordinateOwners.get(site)!.add(owner)
  }
  return {
    combinedRouteViaCount: routeViaCount,
    uniqueOwnedViaSiteSpanCount: sites.size,
    foreignOwnerCoincidentViaSiteSpans: [...coordinateOwners.values()].filter((owners) => owners.size > 1).length,
    combinedRoutePointCount: routePointCount,
    combinedCopperLength: copperLength,
    exactSegmentDeduplicatedCopperLength: [...segments.values()].reduce((a, b) => a + b, 0),
    ownershipMetricDefinition: "Declared net/root aliases only; coordinate proximity never merges owners for deduplication",
    ambiguousDeclaredOwnerAliases: [...ambiguousOwners].sort(),
    copperLengthDefinition: "Sum of same-layer consecutive wire segments; deduplicated metric removes exact same-owner segment repetitions only, not arbitrary collinear overlap. Raw geometry and DRC are retained.",
  }
}

const start = performance.now()
const referenceOptions = {
  traceClearance: 0.1,
  holeClearance: original.minTraceToHoleEdgeClearance,
  includeTraceContinuity: true,
  includeTypedTraceClearance: true,
}
const evaluated = evaluateRelaxedDrc({ inputSrj: original, srjWithPointPairs: pointPairs, routedTraces: traces, includeBoardClearance: true, drcOptions: referenceOptions })
const inputOnly = evaluateRelaxedDrc({ inputSrj: original, srjWithPointPairs: original, routedTraces: [], includeBoardClearance: true, drcOptions: referenceOptions })
const isConnectivityFinding = (error: any): boolean =>
  /unconnected|discontig|not contiguous|not fully connected|no pcb trace|not routed|missing.*trace/i.test(String(error.message ?? ""))
const explicitSearchMarginScreen = original.defaultObstacleMargin === undefined ? null :
  evaluateRelaxedDrc({ inputSrj: original, srjWithPointPairs: pointPairs, routedTraces: traces, includeBoardClearance: true,
    drcOptions: { ...referenceOptions, traceClearance: original.defaultObstacleMargin } })
// This helper annotates PCB ports in-place; it receives a disposable copy.
const libraryErrors = await runAllRoutingChecks(structuredClone(evaluated.circuitJson))
const summary = {
  ...capture,
  referenceFullCopperChecks: summarizeErrors(evaluated.errors),
  inputOnlyPhysicalChecks: summarizeErrors(inputOnly.errors.filter((error) => !isConnectivityFinding(error))),
  inputOnlyConnectivityFindings: summarizeErrors(inputOnly.errors.filter(isConnectivityFinding)),
  libraryRoutingChecks: summarizeErrors(libraryErrors),
  explicitSearchMarginScreen: explicitSearchMarginScreen === null ? null : { appliedTraceClearance: original.defaultObstacleMargin, ...summarizeErrors(explicitSearchMarginScreen.errors) },
  boardCopperChecks: summarizeErrors(checkCopperToBoardEdgeClearance(evaluated.circuitJson)),
  viaBoardChecks: summarizeErrors(checkViasOffBoard(evaluated.circuitJson)),
  physicalCopper: physicalCopperMetrics(evaluated.circuitJson),
  supplementalValidationTimeMs: performance.now() - start,
  validationConfiguration: {
    referenceOptions,
    includeBoardClearance: true,
    libraryChecks: "runAllRoutingChecks, checkCopperToBoardEdgeClearance, checkViasOffBoard, with library defaults and original-input conversion",
    declaredInputFields: Object.fromEntries(Object.entries(original).filter(([key]) =>
      /Clearance|Width|Diameter|diameter|allowBlind|allowVia|defaultObstacleMargin/.test(key))),
    explicitSearchMarginScreenLabel: "Optional search-margin sensitivity screen; defaultObstacleMargin is not asserted to be the reference copper clearance",
  },
  coverage: "Unmodified checks on original-input conversion plus combined preloaded/new copper. Per-type declarations embedded by the converter and library defaults are checked; coverage depends on converter/checker support and is not a proof of every manufacturing/electrical constraint. Official relaxed DRC remains separate.",
}
writeFileSync(resolve(directory, "supplemental-validation.json"), JSON.stringify(summary))
console.log(JSON.stringify({ supplementalValidated: true, validationTimeMs: summary.supplementalValidationTimeMs }))
