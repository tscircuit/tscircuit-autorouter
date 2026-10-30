import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { isDeepStrictEqual } from "node:util"
import { requireValue, verifyRawMask, verifyCanonicalMask, type Move } from "./witness-local-repair-proposals"

const source = process.argv[2]!, output = process.argv[3]!, mode = process.argv[4]!
requireValue(mode === "retained" && process.env.GITHUB_ACTIONS === "true", "Actual retained component predicates are Blacksmith-only")
const prefix = "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/"
const module = async (name: string): Promise<any> => import(pathToFileURL(join(source, prefix, name)).href)
const old = await module("getPipeline9WitnessViaCertificate.source2109.ts")
const tapped = await module("getPipeline9WitnessViaCertificate.componentDiagnostic.ts")
const { Pipeline9IntentOwners } = await module("checkPipeline9OriginalIntentCopper.ts")
const { getRelativeViaTraceTargets } = await module("getRelativeViaTraceTargets.ts")
const { provePipeline9RelativeContacts } = await module("provePipeline9RelativeContacts.ts")
const read = (name: string): any => JSON.parse(readFileSync(join(output, name), "utf8"))
const original = read("original-input.json"), pairs = read("point-pair-context.json"), raw = read("raw-new-traces.json"), canonical = read("canonical-circuit-json.json")
const inputBytes = JSON.stringify([original, pairs, raw, canonical])
const hash = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex")
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
const owners = new Pipeline9IntentOwners(original, pairs)
const stack = original.layerCount === 1 ? ["top"] : ["top", ...Array.from({ length: original.layerCount - 2 }, (_, i) => `inner${i + 1}`), "bottom"]
const names = ["viaPad", "padTrace", "viaTrace", "traceOverlap", "differentNetViaSpacing", "sameNetViaSpacing", "padPad"].sort()
let certificateCalls = 0, instrumentedCalls = 0, targetHelperCalls = 0, materialProofCalls = 0

function detailed(traces: any[]): any {
  const bytes = JSON.stringify(traces)
  certificateCalls++
  const certificate = old.getPipeline9WitnessViaCertificate(original, pairs, traces)
  tapped.relativeMain18ComponentObservations.splice(0)
  instrumentedCalls++
  const observedCertificate = tapped.getPipeline9WitnessViaCertificate(original, pairs, traces)
  requireValue(equal(certificate, observedCertificate), "Complete old/instrumented certificate returns differ")
  requireValue(JSON.stringify(traces) === bytes && JSON.stringify([original, pairs, raw, canonical]) === inputBytes, "Certificate or observations mutated protected input")
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

const baseline = detailed(raw)
requireValue(baseline.fullCertificateSha256 === "e7bbb4acf7c5d7ca21fe86c4937319cc6f9bc5768af27e38a0be852f80e0c2a1" &&
  baseline.fullCertificate.status === "UNKNOWN" && isDeepStrictEqual(JSON.parse(JSON.stringify(baseline.fullCertificate.circuitJson)), canonical), "Original actual18 old-body baseline differs")
const findings = baseline.fullCertificate.copper.allFindings
requireValue(findings.length === 1 && findings[0].checkClass === "viaTrace" && findings[0].classification === "DECLARED_FOREIGN_COPPER", "Exactly one original-owner via-trace target required")
const finding = findings[0], viaOwner = finding.owners.find((entry: any) => entry.type === "pcb_via"), traceOwner = finding.owners.find((entry: any) => entry.type === "pcb_trace")
requireValue(viaOwner?.status === "RESOLVED" && traceOwner?.status === "RESOLVED" && viaOwner.owner !== traceOwner.owner, "Target identities/owners are not distinct original copper")
const via = baseline.fullCertificate.circuitJson.find((entry: any) => entry.type === "pcb_via" && entry.pcb_via_id === viaOwner.id)
requireValue(via !== undefined, "Named target via is absent from old canonical output")
const site = baseline.fullCertificate.sites.find((entry: any) => entry.x === via.x && entry.y === via.y && entry.owner === viaOwner.owner)
const foreignIndex = raw.findIndex((entry: any) => entry.pcb_trace_id === traceOwner.id)
requireValue(site !== undefined && foreignIndex >= 0, "Target does not bind raw via/foreign trace")
const siteOccurrences = coupledOccurrences(raw, site)
requireValue(siteOccurrences.length > 0 && siteOccurrences.every((entry) => {
  const owner = owners.traceReference(raw[entry.traceIndex].connection_name)
  return owner.status === "RESOLVED" && owner.owner === viaOwner.owner
}), "Co-located raw via/landing aliases do not share the original owner")
const foreign = raw[foreignIndex], targets: { point: any; witness: any }[] = [], helperCalls: any[] = []
for (let pointIndex = 0; pointIndex + 1 < foreign.route.length; pointIndex++) {
  const a = foreign.route[pointIndex], b = foreign.route[pointIndex + 1]
  if (a.route_type !== "wire" || b.route_type !== "wire" || a.layer !== b.layer || a.width !== b.width || !site.layers.includes(a.layer)) continue
  const input = { site, start: { x: a.x, y: a.y }, end: { x: b.x, y: b.y }, wireWidth: a.width, wireLayer: a.layer, minimumClearance: finding.error.minimum_clearance }
  targetHelperCalls++
  const values = getRelativeViaTraceTargets(input)
  helperCalls.push({ callIndex: targetHelperCalls, rawTraceIndex: foreignIndex, pointIndex, input, targets: values })
  for (const point of values) if (!targets.some((entry) => equal(entry.point, point))) targets.push({ point, witness: helperCalls[helperCalls.length - 1] })
}
requireValue(targets.length > 0 && targets.length <= 16, "Published helper produced no bounded component portfolio")
const candidates: any[] = []
for (const [index, target] of targets.entries()) {
  const candidate = structuredClone(raw), oldXY = { x: site.x, y: site.y }, newXY = target.point
  const moves = [{ kind: "via", occurrences: siteOccurrences.map((entry: any) => ({ ...entry, oldXY, newXY })) }]
  const flat: Move[] = siteOccurrences.map((entry: any) => ({ kind: "via", occurrences: [entry], oldXY, newXY, maximum: 0.25 }))
  for (const entry of siteOccurrences) {
    const point = raw[entry.traceIndex].route[entry.pointIndex]
    requireValue(entry.pointIndex > 0 && entry.pointIndex + 1 < raw[entry.traceIndex].route.length && !Object.keys(point).some((key) => key.toLowerCase().includes("port")), "Protected raw via occurrence")
    requireValue(original.connections.every((connection: any) => connection.pointsToConnect.every((terminal: any) => terminal.x !== point.x || terminal.y !== point.y)), "Original terminal cannot move")
    Object.assign(candidate[entry.traceIndex].route[entry.pointIndex], newXY)
  }
  requireValue(Math.hypot(newXY.x - oldXY.x, newXY.y - oldXY.y) > 0 && Math.hypot(newXY.x - oldXY.x, newXY.y - oldXY.y) <= 0.25, "Component proposal exceeds hard via cap")
  const differences = verifyRawMask(raw, candidate, flat), observed = detailed(candidate)
  verifyCanonicalMask(baseline.fullCertificate.circuitJson, observed.fullCertificate.circuitJson, raw, candidate, flat)
  materialProofCalls++
  const relativeProof = provePipeline9RelativeContacts({ original, pointPairs: pairs, before: raw, after: candidate, moves, baselineCertificate: baseline.fullCertificate, candidateCertificate: observed.fullCertificate })
  const untargetedDetailedFindingsExactlyUnchanged = equal(baseline.untargetedFingerprint, observed.untargetedFingerprint)
  const globalReasonsAndDemandsUnchanged = equal(baseline.fullCertificate.reasons, observed.fullCertificate.reasons) && baseline.fullCertificate.status === observed.fullCertificate.status && baseline.fullCertificate.demandsChecked === observed.fullCertificate.demandsChecked &&
    ["referenceErrorCount", "srjObstacleViolationCount", "viaPadPolicyViolationCount", "viaInPadViolationCount"].every((key) => baseline.fullCertificate[key] === observed.fullCertificate[key])
  const targetRemovedAndNoOtherStrictFinding = observed.fullCertificate.copper.allFindings.length === 0 && observed.fullCertificate.copper.qualifiedSupportedCopper === true &&
    Object.values(observed.fullCertificate.copper.checks).every((check: any) => Number.isInteger(check.count) && check.count === 0 && check.findings.length === 0)
  const localComponentLead = untargetedDetailedFindingsExactlyUnchanged && globalReasonsAndDemandsUnchanged && targetRemovedAndNoOtherStrictFinding && relativeProof.status === "PASS"
  const file = `component-candidate-${index + 1}-raw.json`
  writeFileSync(join(output, file), JSON.stringify(candidate))
  candidates.push({ index: index + 1, file, proposalOrigin: "PUBLISHED_V2_GET_RELATIVE_VIA_TRACE_TARGETS", witness: target.witness, selectedMoves: moves, differences,
    rawMaskPassed: true, canonicalProtectedMaskPassed: true, rawSha256: hash(candidate), observed, relativeProof, untargetedDetailedFindingsExactlyUnchanged,
    globalReasonsAndDemandsUnchanged, targetRemovedAndNoOtherStrictFinding, localComponentLead, stageSolveCalls: 0, accepted: false, fullBoardRecovery: false, qualityOrSpeedCredit: false })
}
requireValue(JSON.stringify([original, pairs, raw, canonical]) === inputBytes, "Component diagnostic mutated retained inputs")
const result = { status: "RETAINED_COMPONENT_DIAGNOSTIC_ONLY", baseline, namedTarget: finding, helperCalls, targetHelperCalls, materialProofCalls, certificateCalls, instrumentedCalls, candidates,
  stageSolveCalls: 0, routingExecutions: 0, productionSourceUnchanged: true, inputBytesUnchanged: true, accepted: false, fullBoardRecovery: false, qualityOrSpeedCredit: false,
  scope: "Published pure proposal helper plus unchanged complete old-body predicates and source relative proof on exact retained data. Complete untargeted finding records/identities/metrics must remain exact for component credit. No production stage execution, board recovery, solver benchmark, global connectivity or speed credit." }
writeFileSync(join(output, "component-diagnostic.json"), JSON.stringify(result))
console.log(JSON.stringify({ status: result.status, candidates: candidates.length, localComponentLeads: candidates.filter((entry) => entry.localComponentLead).length, targetHelperCalls, materialProofCalls, stageSolveCalls: 0, accepted: false }))
