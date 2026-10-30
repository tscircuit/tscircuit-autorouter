import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { isDeepStrictEqual } from "node:util"
import { requireValue, verifyRawMask, verifyCanonicalMask, type Move } from "./witness-local-repair-proposals"

const source = process.argv[2]!, output = process.argv[3]!, mode = process.argv[4]!
requireValue(mode === "retained" && process.env.GITHUB_ACTIONS === "true", "Actual production stage execution is Blacksmith-only")
const relative = "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/"
const certificateModule = await import(pathToFileURL(join(source, relative, "getPipeline9WitnessViaCertificate.source2109.ts")).href)
const stageModule = await import(pathToFileURL(join(source, relative, "Pipeline9RelativeWitnessRepairSolver.ts")).href)
const read = (name: string): any => JSON.parse(readFileSync(join(output, name), "utf8"))
const original = read("original-input.json"), pairs = read("point-pair-context.json"), traces = read("raw-new-traces.json"), originalCanonical = read("canonical-circuit-json.json")
const originalDeclaredReport = read("declared-intent-via-pad.json")
const protectedTraces: any[] = []
const inputBytes = JSON.stringify([original, pairs, traces, protectedTraces, originalCanonical])
const hash = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex")
const summary = (value: any): any => ({ status: value.status, demandsChecked: value.demandsChecked, reasonCount: value.reasons.length,
  referenceErrorCount: value.referenceErrorCount, srjObstacleViolationCount: value.srjObstacleViolationCount,
  viaPadPolicyViolationCount: value.viaPadPolicyViolationCount, viaInPadViolationCount: value.viaInPadViolationCount,
  foreignViaPadFindings: value.copper.allFindings.filter((f: any) => f.checkClass === "viaPad" && f.classification === "DECLARED_FOREIGN_COPPER").length,
  foreignViaTraceFindings: value.copper.allFindings.filter((f: any) => f.checkClass === "viaTrace" && f.classification === "DECLARED_FOREIGN_COPPER").length,
  ownershipCoverageStatus: value.copper.ownershipCoverageStatus })
const tapped = await import(pathToFileURL(join(source, relative, "getPipeline9WitnessViaCertificate.componentDiagnostic.ts")).href)
const { Pipeline9IntentOwners } = await import(pathToFileURL(join(source, relative, "checkPipeline9OriginalIntentCopper.ts")).href)
const old = certificateModule
const raw = traces
const canonical = originalCanonical
const owners = new Pipeline9IntentOwners(original, pairs)
const stack = original.layerCount === 1 ? ["top"] : ["top", ...Array.from({ length: original.layerCount - 2 }, (_, i) => `inner${i + 1}`), "bottom"]
const names = ["viaPad", "padTrace", "viaTrace", "traceOverlap", "differentNetViaSpacing", "sameNetViaSpacing", "padPad"].sort()
let certificateCalls = 0, instrumentedCalls = 0
const equal = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
function stable(value: any): string {
  const active = new Set<any>()
  const encode = (item: any): any => {
    if (item === null) return ["null"]
    if (item === undefined) return ["undefined"]
    if (typeof item === "number") { requireValue(Number.isFinite(item), "Nonfinite detail cannot enter exact fingerprint"); return ["number", Object.is(item, -0) ? "-0" : String(item)] }
    if (typeof item === "string" || typeof item === "boolean") return [typeof item, item]
    requireValue(typeof item === "object" && !active.has(item), "Unsupported or cyclic detail fingerprint value")
    active.add(item)
    let encoded: any
    if (Array.isArray(item)) {
      requireValue(Reflect.ownKeys(item).every((key) => key === "length" || typeof key === "string" && /^(0|[1-9][0-9]*)$/.test(key) && Number(key) < item.length), "Unsupported array property in exact detail")
      encoded = ["array", Array.from({ length: item.length }, (_, index) => Object.hasOwn(item, index) ? encode(item[index]) : ["hole"])]
    }
    else {
      requireValue((Object.getPrototypeOf(item) === Object.prototype || Object.getPrototypeOf(item) === null) && Reflect.ownKeys(item).length === Object.keys(item).length,
        "Non-plain or hidden-property detail cannot enter exact fingerprint")
      requireValue(Object.keys(item).every((key) => { const descriptor = Object.getOwnPropertyDescriptor(item, key)!; return "value" in descriptor }), "Accessor detail cannot enter exact fingerprint")
      encoded = ["object", Object.keys(item).sort().map((key) => [key, encode(item[key])])]
    }
    active.delete(item)
    return encoded
  }
  return JSON.stringify(encode(value))
}
function coupledOccurrences(traces: any[], site: any): { traceIndex: number; pointIndex: number }[] {
  const occurrences: { traceIndex: number; pointIndex: number }[] = []
  for (const [traceIndex, trace] of traces.entries()) for (const [pointIndex, point] of trace.route.entries()) {
    if ((point.route_type === "wire" || point.route_type === "via") && point.x === site.x && point.y === site.y &&
      (point.route_type === "via" || site.layers.includes(point.layer))) occurrences.push({ traceIndex, pointIndex })
  }
  return occurrences
}
const multiset = (values: any[]): string[] => values.map(stable).sort()

function detailed(traces: any[]): any {
  const bytes = JSON.stringify(traces)
  certificateCalls++
  const certificate = old.getPipeline9WitnessViaCertificate(original, pairs, traces)
  tapped.relativeMain18ComponentObservations.splice(0)
  instrumentedCalls++
  const observedCertificate = tapped.getPipeline9WitnessViaCertificate(original, pairs, traces)
  requireValue(equal(certificate, observedCertificate), "Complete old/instrumented certificate returns differ")
  requireValue(JSON.stringify(traces) === bytes && JSON.stringify([original, pairs, raw, protectedTraces, canonical]) === inputBytes, "Certificate or observations mutated protected input")
  requireValue(certificate.copper.allPublishedCopperChecksRun === true && certificate.copper.ownershipCoverageStatus === "COMPLETE" &&
    equal(Object.keys(certificate.copper.checks).sort(), names) && equal([...certificate.copper.checksRun].sort(), names), "Complete original-owner copper checks required")
  const observations = structuredClone(tapped.relativeMain18ComponentObservations)
  const get = (kind: string): any => { const matches = observations.filter((entry: any) => entry.kind === kind); requireValue(matches.length === 1, "Observation count differs: " + kind); return matches[0] }
  const fixed = get("fixedObstacles"), policy = get("viaPadPolicy"), native = get("nativeErrors"), nativeCenters = get("nativeErrorsWithCenters"), nativeLocated = get("nativeLocationAwareErrors"), inPad = get("viasInPads"), board = get("boardReasons")
  requireValue(fixed.values.length === certificate.srjObstacleViolationCount && policy.values.length === certificate.viaPadPolicyViolationCount &&
    native.values.length === certificate.referenceErrorCount && inPad.values.length === certificate.viaInPadViolationCount, "Observed predicate arrays do not reproduce exact old-body counts")
  const bindings: any[] = []
  for (const [traceIndex, trace] of traces.entries()) {
    const owner = owners.traceReference(trace.connection_name)
    requireValue(owner.status === "RESOLVED", "Raw owner is ambiguous")
    for (const [pointIndex, point] of trace.route.entries()) {
      const next = trace.route[pointIndex + 1]
      if (point.route_type === "via") {
        const siteIndex = certificate.sites.findIndex((site: any) => site.x === point.x && site.y === point.y)
        requireValue(siteIndex >= 0, "Raw via missing from full inventory")
        const site = certificate.sites[siteIndex], zs = site.layers.map((layer: string) => stack.indexOf(layer))
        const route = { connectionName: owner.owner, rootConnectionName: owner.owner, traceThickness: original.minTraceWidth, viaDiameter: site.diameter,
          vias: [{ x: site.x, y: site.y }], route: [{ x: site.x, y: site.y, z: Math.min(...zs) }, { x: site.x, y: site.y, z: Math.max(...zs) }] }
        bindings.push({ routeIndex: bindings.length, traceIndex, pointIndex, kind: "via", pcb_trace_id: trace.pcb_trace_id, originalTraceReference: trace.connection_name, owner, siteIndex, site, route })
      } else if (point.route_type === "wire" && next?.route_type === "wire" && point.layer === next.layer) {
        const route = { connectionName: owner.owner, rootConnectionName: owner.owner, traceThickness: Math.max(point.width, next.width), viaDiameter: original.minViaDiameter ?? 0.3,
          vias: [], route: [{ x: point.x, y: point.y, z: stack.indexOf(point.layer) }, { x: next.x, y: next.y, z: stack.indexOf(next.layer) }] }
        bindings.push({ routeIndex: bindings.length, traceIndex, pointIndex, nextPointIndex: pointIndex + 1, kind: "wire", pcb_trace_id: trace.pcb_trace_id,
          originalTraceReference: trace.connection_name, owner, route, rawStart: point, rawEnd: next })
      }
    }
  }
  requireValue(equal(bindings.map((binding) => binding.route), fixed.context.routes), "Observed temporary obstacle routes do not match every exact raw binding")
  requireValue(equal(fixed.context.stack, stack) && equal(policy.context.stack, stack) && equal(policy.context.sites, certificate.sites), "Observed original stack/sites differ")
  const obstacleBinding = (index: number): any => {
    const obstacle = original.obstacles[index]
    requireValue(obstacle !== undefined, "Violation has no original obstacle")
    const owner = owners.obstacle(obstacle), checked = { ...obstacle, connectedTo: owner.status === "RESOLVED" ? [owner.owner] : [] }
    requireValue(equal(checked, fixed.context.obstacles[index]) && equal(checked, policy.context.obstacles[index]), "Observed checked obstacle differs from original owner normalization")
    return { obstacleIndex: index, originalObstacle: obstacle, originalOwner: owner, checkedObstacle: checked }
  }
  const enrichedFixed = fixed.values.map((record: any) => {
    const binding = bindings[record.routeIndex]
    requireValue(binding !== undefined && binding.kind === record.kind, "Fixed violation raw binding absent")
    return { record, rawBinding: binding, ...obstacleBinding(record.obstacleIndex) }
  })
  const enrichedPolicy = policy.values.map((record: any) => {
    const site = certificate.sites[record.routeIndex], route = policy.context.routes[record.routeIndex]
    requireValue(site !== undefined && route !== undefined, "Policy via-site binding absent")
    const zs = site.layers.map((layer: string) => stack.indexOf(layer))
    requireValue(equal(route, { connectionName: site.owner, rootConnectionName: site.owner, traceThickness: original.minTraceWidth, viaDiameter: site.diameter,
      vias: [{ x: site.x, y: site.y }], route: [{ x: site.x, y: site.y, z: Math.min(...zs) }, { x: site.x, y: site.y, z: Math.max(...zs) }] }), "Policy temporary via route differs")
    return { record, siteIndex: record.routeIndex, site, route, ...obstacleBinding(record.obstacleIndex) }
  })
  return { fullCertificate: certificate, fullCertificateSha256: hash(certificate), completeOriginalInstrumentedReturnEqual: true,
    observations, allObstacleRouteBindings: bindings, enrichedFixedObstacleViolations: enrichedFixed, enrichedViaPadPolicyViolations: enrichedPolicy,
    untargetedFingerprint: { nativeErrors: multiset(native.values), nativeErrorsWithCenters: multiset(nativeCenters.values), nativeLocationAwareErrors: multiset(nativeLocated.values),
      viasInPads: multiset(inPad.values), fixedObstacles: multiset(enrichedFixed), viaPadPolicy: multiset(enrichedPolicy), boardReasons: multiset(board.values) } }
}


function sourceShapedDetails(detail: any, actualTraces: any[]): any {
  const get = (kind: string): any[] => { const records = detail.observations.filter((row: any) => row.kind === kind); requireValue(records.length === 1, "Independent detail kind missing"); return records[0].values }
  const common = (record: any): any => ({ finding: record.record, route: record.rawBinding?.route ?? record.route,
    originalObstacleIndex: record.obstacleIndex, originalObstacle: record.originalObstacle, originalObstacleOwner: record.originalOwner })
  return { nativeErrors: get("nativeErrors"), nativeErrorsWithCenters: get("nativeErrorsWithCenters"), nativeLocationAwareErrors: get("nativeLocationAwareErrors"), viaInPad: get("viasInPads"), boardReasons: get("boardReasons"),
    srjObstacles: detail.enrichedFixedObstacleViolations.map((record: any) => { const binding = record.rawBinding, point = actualTraces[binding.traceIndex].route[binding.pointIndex]
      const raw = { traceIndex: binding.traceIndex, pointIndex: binding.pointIndex, pcb_trace_id: binding.pcb_trace_id, connection_name: binding.originalTraceReference, owner: binding.owner,
        ...(binding.kind === "via" ? { rawPoint: point, site: binding.site } : { rawSegment: [point, actualTraces[binding.traceIndex].route[binding.pointIndex + 1]] }) }
      return { ...common(record), raw }
    }),
    viaPadPolicy: detail.enrichedViaPadPolicyViolations.map((record: any) => ({ ...common(record), raw: record.site })) }
}

const independentBefore = detailed(traces)
const before = independentBefore.fullCertificate
const publishedNames = ["viaPad", "padTrace", "viaTrace", "traceOverlap", "differentNetViaSpacing", "sameNetViaSpacing", "padPad"].sort()
const completeChecks = (certificate: any): boolean => certificate.copper.allPublishedCopperChecksRun === true &&
  certificate.copper.ownershipCoverageStatus === "COMPLETE" && JSON.stringify(Object.keys(certificate.copper.checks).sort()) === JSON.stringify(publishedNames) &&
  JSON.stringify([...certificate.copper.checksRun].sort()) === JSON.stringify(publishedNames)
const geometryChecksZero = (certificate: any): boolean => completeChecks(certificate) && certificate.copper.qualifiedSupportedCopper === true &&
  Object.values(certificate.copper.checks).every((check: any) => check.count === 0) && certificate.referenceErrorCount === 0 &&
  certificate.srjObstacleViolationCount === 0 && certificate.viaPadPolicyViolationCount === 0 && certificate.viaInPadViolationCount === 0
const matchesRetainedViaTraceBaseline = (certificate: any, declared: any): boolean => {
  const signature = (finding: any): string => JSON.stringify({ participants: finding.owners.map((owner: any) => [owner.type, owner.id]).sort(), minimumClearance: finding.error.minimum_clearance })
  return certificate.status === "UNKNOWN" && declared.allPublishedCopperChecksRun === true && declared.ownershipCoverageStatus === "COMPLETE" &&
    publishedNames.every((name) => certificate.copper.checks[name].count === declared.checks[name].count) &&
    certificate.copper.allFindings.length === 1 && declared.allFindings.length === 1 &&
    certificate.copper.allFindings[0].checkClass === "viaTrace" && certificate.copper.allFindings[0].classification === "DECLARED_FOREIGN_COPPER" &&
    declared.allFindings[0].checkClass === "viaTrace" && declared.allFindings[0].classification === "DECLARED_FOREIGN_COPPER" &&
    signature(certificate.copper.allFindings[0]) === signature(declared.allFindings[0])
}
requireValue(completeChecks(before), "Baseline full certificate omitted a published check or original-owner coverage")
requireValue(matchesRetainedViaTraceBaseline(before, originalDeclaredReport),
  "Baseline old-body result does not reproduce the exact original main-MST foreign via-trace finding")
requireValue(isDeepStrictEqual(JSON.parse(JSON.stringify(before.circuitJson)), originalCanonical), "Baseline canonical JSON geometry/material differs from the exact original retained artifact")
requireValue(JSON.stringify([original, pairs, traces, protectedTraces, originalCanonical]) === inputBytes, "Baseline certificate mutated protected retained inputs")
const stage = new stageModule.Pipeline9RelativeWitnessRepairSolver({ originalSrj: original, pointPairs: pairs, traces, protectedTraces })
let solveError: string | null = null, outputError: string | null = null, candidate: any = null
let solveCalls = 0
try { solveCalls++; stage.solve() } catch (error) { solveError = String(error) }
try { candidate = stage.getOutput() } catch (error) { outputError = String(error) }
const productionOutputReturned = Array.isArray(candidate)
if (!productionOutputReturned) candidate = traces
requireValue(JSON.stringify([original, pairs, traces, protectedTraces, originalCanonical]) === inputBytes, "Production stage mutated its retained inputs")
requireValue(stage.iterations <= 20 && stage.MAX_ITERATIONS === 20, "Production stage exceeded the predeclared twenty-step domain")
requireValue(Number.isInteger(stage.stats.proposalCount) && stage.stats.proposalCount >= 0 && stage.stats.proposalCount <= 16 && stage.qualification.proposals === stage.stats.proposalCount, "Production stage exceeded the sixteen-candidate portfolio domain")
const emittedMoves = stage.selectedMoves ?? []
requireValue(emittedMoves.every((move: any) => move.kind === "via"), "This retained main-MST via-trace trial requires via-only output moves")
const flatMoves: Move[] = emittedMoves.flatMap((move: any) => move.occurrences.map((occurrence: any) => ({
  kind: move.kind, occurrences: [{ traceIndex: occurrence.traceIndex, pointIndex: occurrence.pointIndex }],
  oldXY: occurrence.oldXY, newXY: occurrence.newXY, maximum: move.kind === "via" ? 0.25 : 0.02,
})))
requireValue(emittedMoves.every((move: any) => ["via", "wire"].includes(move.kind) && move.occurrences.length > 0), "Unsupported production movement record")
const differences = verifyRawMask(traces, candidate, flatMoves)
for (const move of flatMoves) {
  const occurrence = move.occurrences[0]!, point = traces[occurrence.traceIndex]?.route[occurrence.pointIndex]
  requireValue(point && occurrence.pointIndex > 0 && occurrence.pointIndex < traces[occurrence.traceIndex].route.length - 1, "Production stage moved a protected endpoint")
  requireValue(!Object.keys(point).some((name) => name.toLowerCase().includes("port")), "Production stage moved a port-bearing point")
  requireValue(Math.hypot(move.newXY.x - move.oldXY.x, move.newXY.y - move.oldXY.y) > 0 && Math.hypot(move.newXY.x - move.oldXY.x, move.newXY.y - move.oldXY.y) <= move.maximum, "Production stage exceeded its actual movement cap")
  requireValue(original.connections.every((connection: any) => connection.pointsToConnect.every((terminal: any) => terminal.x !== point.x || terminal.y !== point.y)), "Production stage moved an original terminal coordinate")
}
const candidateBytes = JSON.stringify(candidate)
const independentAfter = detailed(candidate)
const after = independentAfter.fullCertificate
requireValue(JSON.stringify(candidate) === candidateBytes, "Final full certificate mutated the production output")
requireValue(JSON.stringify([original, pairs, traces, protectedTraces, originalCanonical]) === inputBytes, "Final certificate mutated protected retained inputs")
if (differences.length > 0) verifyCanonicalMask(before.circuitJson, after.circuitJson, traces, candidate, flatMoves)
else requireValue(JSON.stringify(before) === JSON.stringify(after), "Unchanged stage output produced a different complete certificate")
const stageBaselineMatches = stage.baselineCertificate !== undefined && JSON.stringify(stage.baselineCertificate) === JSON.stringify(before)
const stageFinalMatches = stage.finalCertificate !== undefined && JSON.stringify(stage.finalCertificate) === JSON.stringify(after)
const afterGeometryChecksZero = geometryChecksZero(after)
const independentGeometryDetailsBefore = sourceShapedDetails(independentBefore, traces), independentGeometryDetailsAfter = sourceShapedDetails(independentAfter, candidate)
const sourceDetailedBeforeMatches = isDeepStrictEqual(stage.baselineGeometryDetails, independentGeometryDetailsBefore)
const sourceDetailedAfterMatches = isDeepStrictEqual(stage.finalGeometryDetails, independentGeometryDetailsAfter)
const untargetedDetailsExact = isDeepStrictEqual(independentBefore.untargetedFingerprint, independentAfter.untargetedFingerprint)
const globalScopeExact = before.status === "UNKNOWN" && after.status === "UNKNOWN" && before.demandsChecked === 139 && after.demandsChecked === 139 &&
  before.reasons.length === 66 && after.reasons.length === 66 && isDeepStrictEqual(before.reasons, after.reasons) && before.referenceErrorCount === after.referenceErrorCount
const strictTargetRemoved = before.copper.allFindings.length === 1 && before.copper.allFindings[0].checkClass === "viaTrace" && after.copper.allFindings.length === 0 &&
  completeChecks(after) && after.copper.qualifiedSupportedCopper === true && Object.values(after.copper.checks).every((check: any) => check.count === 0)
requireValue(completeChecks(after), "Final full certificate omitted a published check or original-owner coverage")
const geometryCount = (certificate: any): number => certificate.referenceErrorCount + certificate.srjObstacleViolationCount + certificate.viaPadPolicyViolationCount + certificate.viaInPadViolationCount + certificate.copper.allFindings.length
const applied = differences.length > 0
if (applied) requireValue(productionOutputReturned && solveError === null && outputError === null && stage.solved === true && stage.failed === false &&
  stageBaselineMatches && stageFinalMatches && stage.relativeProof?.status === "PASS" && stage.qualification?.localRepaired === true && strictTargetRemoved && untargetedDetailsExact && globalScopeExact &&
  sourceDetailedBeforeMatches && sourceDetailedAfterMatches && stage.findingPreservation?.status === "PASS" && stage.stats.acceptanceMode === "EXACT_UNTARGETED_FINDINGS" && stage.stats.untargetedFindingsPreserved === true &&
  stage.stats.targetFindingCountBefore === 1 && stage.stats.targetFindingCountAfter === 0 && independentGeometryDetailsBefore.boardReasons.length === 0 && independentGeometryDetailsAfter.boardReasons.length === 0 && geometryCount(before) === 8 && geometryCount(after) === 7,
  "Production stage returned changed copper without its complete local qualification")
requireValue(after.status !== "PASS", "This retained-stage trial cannot claim unexpected full-board recovery")
const result = { status: "RETAINED_PRODUCTION_STAGE_EXECUTION_ONLY", before: { summary: summary(before), fullCertificateSha256: hash(before), fullCertificate: before },
  after: { summary: summary(after), fullCertificateSha256: hash(after), fullCertificate: after },
  productionStage: { className: "Pipeline9RelativeWitnessRepairSolver", solveCalls, solved: stage.solved, failed: stage.failed, error: stage.error,
    solveError, outputError, productionOutputReturned, outputOrigin: productionOutputReturned ? "ACTUAL_PRODUCTION_STAGE_GET_OUTPUT" : "BASELINE_BECAUSE_PRODUCTION_STAGE_DID_NOT_RETURN",
    iterations: stage.iterations, maximumIterations: stage.MAX_ITERATIONS, attemptedCandidates: stage.stats.proposalCount, maximumCandidates: 16, qualification: stage.qualification, stats: stage.stats,
    selectedMoves: emittedMoves, relativeProof: stage.relativeProof, baselineGeometryDetails: stage.baselineGeometryDetails, finalGeometryDetails: stage.finalGeometryDetails,
    findingPreservation: stage.findingPreservation, baselineGeometryDetailsMatchIndependent: sourceDetailedBeforeMatches, finalGeometryDetailsMatchIndependent: sourceDetailedAfterMatches, baselineCertificateMatchesIndependentBefore: stageBaselineMatches,
    finalCertificateMatchesIndependentAfter: stageFinalMatches },
  independentGeometryDetailsBefore, independentGeometryDetailsAfter, independentDetailedBefore: independentBefore, independentDetailedAfter: independentAfter,
  localRepair: { applied, acceptanceMode: "EXACT_UNTARGETED_FINDINGS", strictTargetRemoved, untargetedDetailsExact, globalScopeExact, geometryChecksZero: afterGeometryChecksZero, beforeGeometryFindingCount: geometryCount(before), afterGeometryFindingCount: geometryCount(after), rawMaskPassed: true, canonicalProtectedMaskPassed: true, differences,
    independentRelativeProofReplay: "PENDING_PYTHON_DATA_ONLY_REPLAY", accepted: false, fullBoardRecovery: false, qualityOrSpeedCredit: false },
  outputRawSha256: hash(candidate), inputBytesUnchanged: true, stageSolveCalls: solveCalls, routingExecutions: 0,
  accepted: false, fullBoardRecovery: false, qualityOrSpeedCredit: false,
  scope: "One actual production local-stage solve on exact retained data with exact untargeted detailed finding preservation; geometry8-to7 is local improvement only. Full original before/after source2109 certificate objects and all reason/check arrays remain visible. Relative local proof and improvement are separate from global UNKNOWN or full-board acceptance. No pipeline routing or speed claim." }
writeFileSync(join(output, "production-stage-output-traces.json"), JSON.stringify(candidate))
writeFileSync(join(output, "production-stage-trial.json"), JSON.stringify(result))
console.log(JSON.stringify({ status: result.status, before: result.before.summary, after: result.after.summary,
  stageSolveCalls: solveCalls, localRepairApplied: applied, productionStageStatus: stage.qualification?.status,
  accepted: false, fullBoardRecovery: false, qualityOrSpeedCredit: false }))
requireValue(solveError === null && outputError === null && productionOutputReturned && stage.solved === true && stage.failed === false,
  "Unexpected production stage error retained diagnostically; trial has no repair or acceptance credit")
