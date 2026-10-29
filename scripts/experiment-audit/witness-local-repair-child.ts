import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { cloneWithMoves, verifyRawMask, verifyCanonicalMask, wireNormalOffsets, requireValue, type Move } from "./witness-local-repair-proposals"

const source = process.argv[2]!, output = process.argv[3]!, mode = process.argv[4]!
requireValue(mode === "retained" && process.env.GITHUB_ACTIONS === "true", "Actual retained certificate evaluation is Blacksmith-only")
const relative = "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/"
const certificateModule = await import(pathToFileURL(join(source, relative, "getPipeline9WitnessViaCertificate.ts")).href)
const diagnosticModule = await import(pathToFileURL(join(source, relative, "getPipeline9WitnessViaCertificate.diagnostic.ts")).href)
const stageModule = await import(pathToFileURL(join(source, relative, "Pipeline9WitnessViaPadRepairSolver.ts")).href)
const ownerModule = await import(pathToFileURL(join(source, relative, "checkPipeline9OriginalIntentCopper.ts")).href)
const original = JSON.parse(readFileSync(join(output, "original-input.json"), "utf8"))
const pairs = JSON.parse(readFileSync(join(output, "point-pair-context.json"), "utf8"))
const traces = JSON.parse(readFileSync(join(output, "raw-new-traces.json"), "utf8"))
const before = JSON.stringify([original, pairs, traces])
const hash = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex")
const summary = (value: any): any => ({ status: value.status, demandsChecked: value.demandsChecked, reasonCount: value.reasons.length,
  referenceErrorCount: value.referenceErrorCount, srjObstacleViolationCount: value.srjObstacleViolationCount, viaPadPolicyViolationCount: value.viaPadPolicyViolationCount,
  viaInPadViolationCount: value.viaInPadViolationCount, foreignViaPadFindings: value.copper.allFindings.filter((finding: any) => finding.checkClass === "viaPad" && finding.classification === "DECLARED_FOREIGN_COPPER").length,
  ownershipCoverageStatus: value.copper.ownershipCoverageStatus })
const baseline = certificateModule.getPipeline9WitnessViaCertificate(original, pairs, traces)
const observed = diagnosticModule.getPipeline9WitnessViaCertificate(original, pairs, traces)
requireValue(JSON.stringify(baseline) === JSON.stringify(observed), "Unmodified and instrumented baseline certificates differ")
const owners = new ownerModule.Pipeline9IntentOwners(original, pairs)
const findings = baseline.copper.allFindings.filter((value: any) => value.checkClass === "viaPad" && value.classification === "DECLARED_FOREIGN_COPPER")
requireValue(findings.length === 1 && findings.length === baseline.copper.allFindings.length, "Exactly one isolated published foreign via-pad finding is required")
const finding = findings[0]
const participant = finding.owners.find((value: any) => value.type === "pcb_via")
const viaOwner = baseline.copper.viaOwners.find((value: any) => value.originalId === participant?.id)
const via = viaOwner && baseline.circuitJson[viaOwner.canonicalIndex]
const site = via && baseline.sites.find((value: any) => value.x === via.x && value.y === via.y)
requireValue(site, "Via witness has no exact raw manufactured-site mapping")
requireValue(original.connections.every((connection: any) => connection.pointsToConnect.every((value: any) => value.x !== site.x || value.y !== site.y)), "Original terminal at selected via site is protected")
const padParticipant = finding.owners.find((value: any) => value.type === "pcb_smtpad")
const padOwner = baseline.copper.padOwners.find((value: any) => value.originalId === padParticipant?.id)
const pad = padOwner && baseline.circuitJson[padOwner.canonicalIndex]
requireValue(pad && ["rect", "rotated_rect", "circle"].includes(pad.shape), "Unsupported via-pad proposal geometry")
const stage = new stageModule.Pipeline9WitnessViaPadRepairSolver({ originalSrj: original, pointPairs: pairs, traces, protectedTraces: [] })
stage.selectedSite = site
const viaFaces = stage.padFaceProposals(pad, finding.error.minimum_clearance)
requireValue(viaFaces.length === 4, "Existing single-pad helper must return four faces")
const viaOccurrences: any[] = []
for (const [traceIndex, trace] of traces.entries()) {
  const owner = owners.traceReference(trace.connection_name)
  for (const [pointIndex, point] of trace.route.entries()) {
    if (point.x !== site.x || point.y !== site.y) continue
    if (point.route_type === "via" || point.route_type === "wire" && site.layers.includes(point.layer)) {
      requireValue(owner.status === "RESOLVED" && owner.owner === site.owner, "Foreign coupled via-site contributor")
      viaOccurrences.push({ traceIndex, pointIndex })
    }
  }
}
requireValue(viaOccurrences.length > 0 && site.occurrences.every((value: any) => viaOccurrences.some((other) => other.traceIndex === value.traceIndex && other.pointIndex === value.pointIndex)), "Raw via contributors are not completely coupled")
const tapped = diagnosticModule.witnessContactDiagnostics.find((value: any) => value.kind === "getFixedObstacleViolations")
const wireFindings = tapped.values.filter((value: any) => value.kind === "wire")
requireValue(wireFindings.length === 1, "Exactly one independent wire-envelope witness is required")
const wireFinding = wireFindings[0], rawRoute = tapped.context.routes[wireFinding.routeIndex]
const obstacle = original.obstacles[wireFinding.obstacleIndex]
requireValue(obstacle.type === "rect" && ["rotation", "ccw_rotation", "ccwRotation"].every((key) => obstacle[key] === undefined || obstacle[key] === 0), "Only an unrotated original rectangle is supported")
const obstacleOwner = owners.obstacle(obstacle)
requireValue(obstacleOwner.status === "RESOLVED" && obstacleOwner.owner !== rawRoute.connectionName && rawRoute.route.length === 2, "Wire witness is not a definite foreign two-point route")
const stack = ["top", ...Array.from({ length: original.layerCount - 2 }, (_, i) => "inner" + (i + 1)), "bottom"]
const [a, b] = rawRoute.route
const matched: any[] = []
for (const [traceIndex, trace] of traces.entries()) for (let pointIndex = 0; pointIndex + 1 < trace.route.length; pointIndex++) {
  const left = trace.route[pointIndex], right = trace.route[pointIndex + 1]
  if (left.route_type === "wire" && right.route_type === "wire" && left.layer === right.layer && left.layer === stack[a.z] &&
      left.x === a.x && left.y === a.y && right.x === b.x && right.y === b.y) matched.push({ traceIndex, pointIndex })
}
requireValue(matched.length === 1, "Wire witness must map to exactly one raw segment")
const wire = matched[0], wirePoints = [wire.pointIndex, wire.pointIndex + 1].map((pointIndex) => ({ traceIndex: wire.traceIndex, pointIndex }))
for (const occurrence of wirePoints) {
  const point = traces[occurrence.traceIndex].route[occurrence.pointIndex]
  const sameXY = traces.flatMap((trace: any, traceIndex: number) => trace.route.map((value: any, pointIndex: number) => ({ value, traceIndex, pointIndex }))).filter((value: any) => value.value.x === point.x && value.value.y === point.y)
  requireValue(sameXY.length === 1 && original.connections.every((connection: any) => connection.pointsToConnect.every((value: any) => value.x !== point.x || value.y !== point.y)), "Wire endpoint has coupled or original-terminal geometry")
}
const offsets = wireNormalOffsets(a, b, obstacle.center, wireFinding.severity, 0.02)
const faces = viaFaces.map((point: any, index: number) => ({ point, index, distance: Math.hypot(point.x - site.x, point.y - site.y) }))
const eligibleFaces = faces.filter((value: any) => value.distance > 0 && value.distance <= 0.25)
requireValue(eligibleFaces.length > 0 && eligibleFaces.length * offsets.length <= 16, "No bounded diagnostic plan or candidate budget exceeded")
const baselineGraphReasons = baseline.reasons.filter((value: string) => value !== "Original SRJ obstacle-envelope violations remain")
const candidates: any[] = []
for (const face of eligibleFaces) for (const [offsetIndex, offset] of offsets.entries()) {
  const moves: Move[] = [{ kind: "via", occurrences: viaOccurrences, oldXY: { x: site.x, y: site.y }, newXY: face.point, maximum: 0.25 },
    ...wirePoints.map((occurrence) => { const point = traces[occurrence.traceIndex].route[occurrence.pointIndex]; return { kind: "wire", occurrences: [occurrence], oldXY: { x: point.x, y: point.y }, newXY: { x: point.x + offset.x, y: point.y + offset.y }, maximum: 0.02 } })]
  const candidate = cloneWithMoves(traces, moves)
  const differences = verifyRawMask(traces, candidate, moves)
  const candidateBytes = JSON.stringify(candidate)
  const certificate = certificateModule.getPipeline9WitnessViaCertificate(original, pairs, candidate)
  requireValue(JSON.stringify(candidate) === candidateBytes, "Certificate mutated its candidate input")
  verifyRawMask(traces, candidate, moves)
  verifyCanonicalMask(baseline.circuitJson, certificate.circuitJson, traces, candidate, moves)
  requireValue(JSON.stringify([original, pairs, traces]) === before, "Candidate certificate mutated protected input")
  const value = summary(certificate)
  const sameGlobalReasonTextAndCount = JSON.stringify(certificate.reasons.filter((reason: string) => reason !== "Original SRJ obstacle-envelope violations remain")) === JSON.stringify(baselineGraphReasons)
  const geometryChecksZero = Object.values(certificate.copper.checks).every((check: any) => check.count === 0) && value.referenceErrorCount === 0 &&
    value.srjObstacleViolationCount === 0 && value.viaPadPolicyViolationCount === 0 && value.viaInPadViolationCount === 0
  const fullRecovery = certificate.status === "PASS"
  requireValue(!fullRecovery, "Known retained global failures unexpectedly disappeared; no recovery claim is allowed")
  candidates.push({ index: candidates.length + 1, viaFaceIndex: face.index, wireOffsetIndex: offsetIndex, wireOffset: offset, moves, differences,
    rawMaskPassed: true, canonicalProtectedMaskPassed: true, candidateRawSha256: hash(candidate), fullCertificateSha256: hash(certificate), summary: value,
    reasons: certificate.reasons, fullCertificate: certificate, sameGlobalReasonTextAndCount, geometryChecksZero,
    localComponentLead: geometryChecksZero && sameGlobalReasonTextAndCount, failedOwnerIdentityPreservation: "NOT_ESTABLISHED", connectivityPartitionPreservation: "NOT_ESTABLISHED", accepted: false, fullBoardRecovery: false, qualityOrSpeedCredit: false })
  writeFileSync(join(output, "candidate-" + candidates.length + "-traces.json"), JSON.stringify(candidate))
}
requireValue(JSON.stringify([original, pairs, traces]) === before, "Diagnostic mutated retained inputs")
const result = { status: "DIAGNOSTIC_ONLY_LOCAL_COMPONENT_EVALUATION", baseline: { summary: summary(baseline), fullCertificateSha256: hash(baseline), reasons: baseline.reasons },
  originalInstrumentedBaselineReturnEqual: true, selectedVia: { id: via.pcb_via_id, oldXY: { x: site.x, y: site.y }, occurrences: viaOccurrences, padId: pad.pcb_smtpad_id },
  selectedWire: { finding: wireFinding, rawTraceId: traces[wire.traceIndex].pcb_trace_id, occurrences: wirePoints, obstacleIndex: wireFinding.obstacleIndex, originalObstacle: obstacle },
  proposalDomain: { viaMaximum: 0.25, wireMaximum: 0.02, newDiagnosticSubsetNotProductionSourceCap: true, sourceOnlyHasCandidateCountBound: true, maximumCandidates: 16,
    excludedViaFaces: faces.filter((value: any) => value.distance > 0.25).map((value: any) => ({ ...value, status: "OUT_OF_DIAGNOSTIC_DOMAIN" })) },
  candidates, inputBytesUnchanged: true, productionSourceUnchanged: true, stageSolveCalls: 0, routingExecutions: 0, qualityOrSpeedCredit: false, fullBoardRecovery: false,
  scope: "Retained-input component lead only. Every candidate uses the unchanged complete source2109 certificate; full global status and reason text remain visible; equality of generic reason text/count does not establish failed-owner identity or connectivity-partition preservation. No pipeline or stage solve, no accepted output and no solved-board/timing credit." }
writeFileSync(join(output, "local-repair-diagnostic.json"), JSON.stringify(result))
console.log(JSON.stringify({ status: result.status, baseline: result.baseline.summary, candidates: candidates.map((value) => ({ index: value.index, summary: value.summary, localComponentLead: value.localComponentLead, unchangedGlobalFailureReasons: value.unchangedGlobalFailureReasons })), fullBoardRecovery: false, qualityOrSpeedCredit: false }))
