import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const source = process.argv[2]!
const output = process.argv[3]!
const mode = process.argv[4]!
const relative = "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/"
const originalModule = await import(pathToFileURL(join(source, relative, "getPipeline9WitnessViaCertificate.ts")).href)
const diagnosticModule = await import(pathToFileURL(join(source, relative, "getPipeline9WitnessViaCertificate.diagnostic.ts")).href)
let original: any, pairs: any, traces: any
if (mode === "synthetic") {
  const fixture = await import(pathToFileURL(join(source, "tests/features/witnessViaPadRepairFixture.ts")).href)
  const value = fixture.witnessViaPadRepairFixture(1)
  original = value.originalSrj; pairs = value.pointPairs; traces = value.traces
} else {
  if (mode !== "retained" || process.env.GITHUB_ACTIONS !== "true") throw new Error("Retained actual-dataset certificate checking is runner-only")
  original = JSON.parse(readFileSync(join(output, "original-input.json"), "utf8"))
  pairs = JSON.parse(readFileSync(join(output, "point-pair-context.json"), "utf8"))
  traces = JSON.parse(readFileSync(join(output, "raw-new-traces.json"), "utf8"))
}
const before = JSON.stringify([original, pairs, traces])
const native = originalModule.getPipeline9WitnessViaCertificate(original, pairs, traces)
if (JSON.stringify([original, pairs, traces]) !== before) throw new Error("Original certificate mutated retained input")
const detailed = diagnosticModule.getPipeline9WitnessViaCertificate(original, pairs, traces)
if (JSON.stringify(native) !== JSON.stringify(detailed)) throw new Error("Instrumented complete certificate return differs")
if (JSON.stringify([original, pairs, traces]) !== before) throw new Error("Instrumented certificate mutated retained input")
const graph = diagnosticModule.witnessContactDiagnostics.filter((value: any) => value.kind === "owner-contact-graph")
const owners = new Map(native.copper.traceOwners.map((value: any) => [value.originalId, value.owner]))
const allPoints = graph.flatMap((value: any) => value.points)
const roots = new Map(allPoints.map((value: any) => [value.key, value.root]))
const segments: any[] = []
for (const [traceIndex, trace] of traces.entries()) {
  const owner = owners.get(trace.pcb_trace_id)
  for (let pointIndex = 0; pointIndex + 1 < trace.route.length; pointIndex++) {
    const a = trace.route[pointIndex], b = trace.route[pointIndex + 1]
    if (a.route_type !== "wire" || b.route_type !== "wire" || a.layer !== b.layer) continue
    segments.push({ owner, traceIndex, traceId: trace.pcb_trace_id, pointIndex, layer: a.layer,
      start: { x: a.x, y: a.y }, end: { x: b.x, y: b.y }, width: Math.max(a.width, b.width),
      startRoot: roots.get(JSON.stringify([owner, a.x, a.y, a.layer])), endRoot: roots.get(JSON.stringify([owner, b.x, b.y, b.layer])) })
  }
}
function distance(point: any, segment: any): number {
  const dx = segment.end.x - segment.start.x, dy = segment.end.y - segment.start.y
  const length = dx * dx + dy * dy
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - segment.start.x) * dx + (point.y - segment.start.y) * dy) / length))
  return Math.hypot(point.x - segment.start.x - t * dx, point.y - segment.start.y - t * dy)
}
const interiorCandidates: any[] = []
let totalInteriorCandidates = 0
for (const point of allPoints) {
  for (const segment of segments) {
    if (point.owner !== segment.owner || point.layer !== segment.layer || point.root === segment.startRoot) continue
    const minimum = distance(point, segment)
    if (minimum > segment.width / 2) continue
    totalInteriorCandidates++
    if (interiorCandidates.length < 10000) interiorCandidates.push({ point, segment, centerlineDistance: minimum,
      exactComputedCenterlineContact: minimum === 0, withinWireHalfWidth: minimum <= segment.width / 2,
      diagnosticOnly: true, addedGraphEdge: false })
  }
}
const platedHoles = native.copper.padOwners.filter((value: any) => native.circuitJson[value.canonicalIndex]?.type === "pcb_plated_hole").map((ownerRecord: any) => {
  const geometry = native.circuitJson[ownerRecord.canonicalIndex]
  const relevantSegments = segments.filter((value: any) => value.owner === ownerRecord.owner && geometry.layers?.includes(value.layer))
  const radiusBound = Math.max(geometry.outer_diameter ?? 0, geometry.outer_width ?? 0, geometry.outer_height ?? 0, geometry.width ?? 0, geometry.height ?? 0) / 2
  return { ownerRecord, canonicalGeometry: geometry,
    matchingOriginalObstacles: original.obstacles.filter((value: any) => value.circuitJsonMetadata?.pcb_plated_hole_id === geometry.pcb_plated_hole_id),
    originalDeclarationAndCanonicalProjectionRemainSeparate: true,
    rawWireSegments: relevantSegments.map((segment: any) => ({ ...segment,
      minimumCenterlineDistanceToHoleCenter: distance(geometry, segment),
      maximumEndpointDistanceToHoleCenter: Math.max(Math.hypot(segment.start.x - geometry.x, segment.start.y - geometry.y), Math.hypot(segment.end.x - geometry.x, segment.end.y - geometry.y)),
      diagnosticOuterRadiusBound: radiusBound,
      noAnnulusOrBarrelConnectivityAsserted: true })),
    rawVertices: allPoints.filter((value: any) => value.owner === ownerRecord.owner && geometry.layers?.includes(value.layer)).map((point: any) => ({ ...point, distanceToCenter: Math.hypot(point.x - geometry.x, point.y - geometry.y) })),
  }
})
const summary = { status: native.status, demandsChecked: native.demandsChecked, reasonCount: native.reasons.length,
  referenceErrorCount: native.referenceErrorCount, srjObstacleViolationCount: native.srjObstacleViolationCount,
  viaPadPolicyViolationCount: native.viaPadPolicyViolationCount, viaInPadViolationCount: native.viaInPadViolationCount,
  foreignViaPadFindings: native.copper.allFindings.filter((finding: any) => finding.checkClass === "viaPad" && finding.classification === "DECLARED_FOREIGN_COPPER").length,
  ownershipCoverageStatus: native.copper.ownershipCoverageStatus }
const result = { status: "DIAGNOSTIC_ONLY_COMPLETE_CERTIFICATE_EQUAL", summary, completeCertificateReturnEqual: true,
  completeCertificateSha256: createHash("sha256").update(JSON.stringify(native)).digest("hex"), inputBytesUnchanged: true,
  reasons: native.reasons, graph, segments, platedHoles,
  exactOriginalViolationArrays: diagnosticModule.witnessContactDiagnostics.filter((value: any) => value.kind !== "owner-contact-graph"),
  potentialInteriorContacts: { total: totalInteriorCandidates, retained: interiorCandidates.length, truncated: totalInteriorCandidates > interiorCandidates.length, values: interiorCandidates, diagnosticOnly: true, addedGraphEdges: 0 },
  qualityOrSpeedCredit: false, routingExecutions: 0, mode }
writeFileSync(join(output, "diagnostic.json"), JSON.stringify(result))
console.log(JSON.stringify({ status: result.status, summary, graphOwners: graph.length, rawWireSegments: segments.length, originalPlatedHoles: platedHoles.length, potentialInteriorCandidates: totalInteriorCandidates, completeCertificateReturnEqual: true, mode }))
