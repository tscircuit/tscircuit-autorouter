import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { auditCapturedSuccess } from "./audit-coalesced-captured-success"
import { auditOriginalSourceViaPads } from "./audit-original-source-via-pads"
import { originalOwners, strictCopperMetrics } from "./audit-retention-fixed-artifact"
import { auditRouteBundle } from "./audit-retention-stage-geometry"
import { evaluateRelaxedDrc } from "../../lib/testing/evaluate-relaxed-drc"
import { runAllRoutingChecks } from "@tscircuit/checks"
import { removeRedundantVias } from "./postroute-prototype/lib/utils/removeRedundantVias"

type Json = any
const sha = (value: string): string => createHash("sha256").update(value).digest("hex")
const jsonHash = (value: Json): string => sha(JSON.stringify(value))
const json = (path: string): Json => JSON.parse(readFileSync(path, "utf8"))
const stack = ["top", "inner1", "inner2", "bottom"]
const prototypeRoot = join(dirname(fileURLToPath(import.meta.url)), "postroute-prototype")
const prototypeHashes: Record<string, string> = {
  "lib/utils/removeRedundantVias.ts": "1552130528c54fc9de41e841b2081f26d901e338c3b489b420a31ce194a3b111",
  "lib/utils/getViaDimensions.ts": "1994c50d7c0802c73af323f1199c4d0d1c2ef1a921f4df7608ecc16029e48e1d",
  "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/getPowerTraceExpansionConnectionNames.ts": "7189ea6a9d575ea9f256317d72fb46a4e551ab2eddf95ad4d8f1e1ca978a86f0",
}

export function assertCameraCaptureScope(binding: Json): void {
  assert.equal(binding.sourceSha, "ee0dac23c8ff76fde81a0124bf444790a8394f25")
  const inputHashes: Record<string, string> = {
    "srj18:14": "4a513349694b8558e159dfc88eda8344f1b6158c63f89f558a9cc8c2fa0bf71e",
    "srj24:12": "6d6a82f0dc70a67c855e82389563b91dcf2b82ad29cd72d9a7429ec2ab03a57e",
  }
  const expected = inputHashes[`${binding.dataset}:${binding.sample}`]
  assert(expected !== undefined, "Offline prototype scope excludes this original dataset/sample")
  assert.equal(binding.expectedHashes.input, expected, "Original per-dataset camera input changed")
}

export function viaSites(original: Json, traces: Json[]): Map<string, number> {
  const owners = originalOwners(original), output = new Map<string, number>()
  for (const trace of traces) {
    const owner = owners.trace(trace)
    assert.equal(owner.status, "resolved", "Original typed trace ownership unresolved")
    for (const point of trace.route) {
      if (point.route_type !== "via") continue
      const diameter = point.via_diameter ?? 0.3, hole = point.via_hole_diameter ?? diameter * 0.5
      assert.equal(diameter, 0.3)
      assert.equal(hole, 0.15)
      assert(stack.includes(point.from_layer) && stack.includes(point.to_layer) && point.from_layer !== point.to_layer)
      const key = JSON.stringify([owner.owners, point.x, point.y, stack, diameter, hole])
      output.set(key, (output.get(key) ?? 0) + 1)
    }
  }
  return output
}

function copperStructure(original: Json, traces: Json[]): Json {
  const owners = originalOwners(original), wires: string[] = [], terminalAnnotations: string[] = []
  const declared = new Set(original.connections.flatMap((connection: Json) => connection.pointsToConnect
    .flatMap((point: Json) => [point.pcb_port_id, point.pointId].filter((id: Json) => typeof id === "string"))))
  const terminalReferences = new Set<string>()
  for (const trace of traces) {
    const owner = owners.trace(trace)
    assert.equal(owner.status, "resolved")
    for (const reference of trace.connectsTo ?? []) if (declared.has(reference)) {
      terminalReferences.add(JSON.stringify([owner.owners, reference]))
    }
    for (let index = 0; index < trace.route.length; index++) {
      const point = trace.route[index], next = trace.route[index + 1]
      if (point.route_type !== "wire") continue
      for (const field of ["start_pcb_port_id", "end_pcb_port_id"]) if (point[field] !== undefined) {
        terminalAnnotations.push(JSON.stringify([owner.owners, field, point[field], point.x, point.y, point.layer]))
      }
      if (next?.route_type === "wire") {
        assert.equal(point.layer, next.layer)
        const ends = [[point.x, point.y, point.width], [next.x, next.y, next.width]]
          .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2])
        wires.push(JSON.stringify([owner.owners, point.layer, ends]))
      }
    }
  }
  return { wires: wires.sort(), terminalAnnotations: terminalAnnotations.sort(), terminalReferences: [...terminalReferences].sort() }
}

function stableError(value: Json): Json {
  if (Array.isArray(value)) return value.map(stableError)
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort()
    .filter((key) => !key.endsWith("_error_id"))
    .map((key) => [key, stableError(value[key])]))
  return value
}

function hardLibraryErrors(errors: Json[]): string[] {
  return errors.filter((error) => !error.type.endsWith("_warning"))
    .map((error) => JSON.stringify(stableError(error))).sort()
}

function findingCounts(errors: Json[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const error of errors) counts[error.type] = (counts[error.type] ?? 0) + 1
  return counts
}

function distanceToSegment(point: Json, first: Json, second: Json): number {
  const dx = second.x - first.x, dy = second.y - first.y
  const denominator = dx * dx + dy * dy
  const t = denominator === 0 ? 0 : Math.max(0, Math.min(1,
    ((point.x - first.x) * dx + (point.y - first.y) * dy) / denominator))
  return Math.hypot(point.x - first.x - t * dx, point.y - first.y - t * dy)
}

export function assertIndependentDeletedDrillSafety(original: Json, traces: Json[], before: Map<string, number>,
  after: Map<string, number>, candidate: Json[], originalSourceCircuit: Json[]): void {
  const owners = originalOwners(original)
  const beforeEndpoints = new Set<string>(), wires: Json[] = []
  for (const trace of traces) {
    const owner = owners.trace(trace).owners[0]
    for (const point of [trace.route[0], trace.route.at(-1)]) if (point?.route_type === "wire") {
      beforeEndpoints.add(JSON.stringify([owner, point.x, point.y, point.layer]))
    }
    for (let i = 1; i < trace.route.length; i++) {
      const a = trace.route[i - 1], b = trace.route[i]
      if (a.route_type === "wire" && b.route_type === "wire" && a.layer === b.layer) {
        wires.push({ owner, a, b, radius: Math.max(a.width, b.width) / 2 })
      }
    }
  }
  const retained = [...after.keys()].map((key) => JSON.parse(key))
  for (const site of before.keys()) {
    if (after.has(site)) continue
    const [owner, x, y, , diameter] = JSON.parse(site)
    const point = { x, y }, radius = diameter / 2
    for (const wire of wires) if (wire.owner !== owner[0]) {
      assert(distanceToSegment(point, wire.a, wire.b) > radius + wire.radius + 1e-9,
        "Deleted drill footprint approaches foreign original-owner wire copper")
    }
    for (const obstacle of original.obstacles) {
      assert(Math.hypot(x - obstacle.center.x, y - obstacle.center.y) > radius
        + Math.hypot(obstacle.width, obstacle.height) / 2 + 1e-9,
        "Deleted drill footprint approaches an original pad or hole")
    }
    for (const pad of originalSourceCircuit) {
      if (pad.type !== "pcb_smtpad" && pad.type !== "pcb_plated_hole") continue
      const plated = pad.type === "pcb_plated_hole"
      const circle = pad.shape === "circle"
      const width = circle ? (plated ? pad.outer_diameter : pad.radius * 2) : pad.width ?? pad.rect_pad_width
      const height = circle ? width : pad.height ?? pad.rect_pad_height
      assert([pad.x, pad.y, width, height].every(Number.isFinite) && width > 0 && height > 0 &&
        ["circle", "rect", "pill"].includes(pad.shape), "Original source pad has no proved conservative bound")
      const bound = circle ? width / 2 : Math.hypot(width, height) / 2
      assert(Math.hypot(x - pad.x, y - pad.y) > radius + bound + 1e-9,
        "Deleted drill footprint approaches a supported or unsupported original source pad body")
    }
    for (const connection of original.connections) for (const terminal of connection.pointsToConnect) {
      assert(Math.hypot(x - terminal.x, y - terminal.y) > radius + 1e-9,
        "Deleted site covers an original terminal")
    }
    for (const other of retained) {
      assert(Math.hypot(x - other[1], y - other[2]) > radius + other[4] / 2 + 1e-9,
        "Deleted site overlaps another retained manufactured via")
    }
  }
  for (const trace of candidate) {
    const owner = owners.trace(trace).owners[0]
    for (const point of [trace.route[0], trace.route.at(-1)]) {
      assert.equal(point.route_type, "wire", "Candidate endpoint is not wire copper")
      if (beforeEndpoints.has(JSON.stringify([owner, point.x, point.y, point.layer]))) continue
      assert(retained.every((via) => Math.hypot(point.x - via[1], point.y - via[2]) > via[5] / 2 + 1e-9),
        "New fragment endpoint lies in a retained drill void")
      assert(candidate.some((other) => other !== trace && owners.trace(other).owners[0] === owner &&
        other.route.some((first: Json, i: number) => {
          const second = other.route[i + 1]
          return first.route_type === "wire" && second?.route_type === "wire" &&
            first.layer === point.layer && second.layer === point.layer &&
            distanceToSegment(point, first, second) < Math.min(first.width, second.width) / 2 - 1e-9
        })), "Via deletion introduced an unattached wire fragment endpoint")
    }
  }
}

export async function auditPostrouteCapture(binding: Json): Promise<Json> {
  assertCameraCaptureScope(binding)
  for (const [path, expected] of Object.entries(prototypeHashes)) {
    assert.equal(sha(readFileSync(join(prototypeRoot, path), "utf8")), expected, "Frozen prototype or dependency bytes changed")
  }
  const originalQualification = await auditCapturedSuccess(binding)
  assert.equal(originalQualification.originalReferenceErrorCount, 0)
  assert.equal(originalQualification.mandatoryLibraryPadErrorCount, 0)
  const raw = binding.rawDirectory
  const original = json(join(raw, "original-input.json")), traces = json(join(raw, "raw-new-traces.json"))
  const pairs = json(join(raw, "point-pair-context.json"))
  assert.equal(original.layerCount, 4)
  assert(!original.traces?.length, "Frozen prototype excludes preloaded copper")
  const inputHash = jsonHash(original), tracesHash = jsonHash(traces)
  const beforeSites = viaSites(original, traces), beforeStructure = copperStructure(original, traces)
  const result = removeRedundantVias(original, traces)
  assert.equal(jsonHash(original), inputHash, "Prototype mutated original declarations")
  assert.equal(jsonHash(traces), tracesHash, "Prototype mutated captured source traces")
  const afterHash = jsonHash(result.traces)
  const before = strictCopperMetrics(original, traces).summary
  const base = { label: binding.label, sourceSha: binding.sourceSha, sourceInputSha256: binding.expectedHashes.input,
    sourceTracesSha256: binding.expectedHashes.traces, prototypeLocalSha: "6fcbbfdd37c1057456c732ef6a2c189ab5790d62",
    prototypeTree: "800f5544d1157a3daef9265167892dd215dea453", prototypeHashes,
    originalCanonicalTracesSha256: tracesHash,
    materializedTracesSha256: afterHash, removedViaSites: result.removedViaSites,
    removedViaOccurrences: result.removedViaOccurrences, unsupportedReason: result.unsupportedReason ?? null,
    originalOwnershipCopperBefore: before, inputUnchanged: true, capturedTracesUnchanged: true }
  if (result.removedViaSites === 0) {
    assert.equal(afterHash, tracesHash, "Zero-removal prototype changed copper")
    assert.equal(result.removedViaOccurrences, 0)
    return { ...base, status: result.unsupportedReason ? "UNSUPPORTED_UNCHANGED" : "NO_QUALIFIED_REMOVAL_UNCHANGED",
      originalOwnershipCopperAfter: before, outputCanonicalSerializationIdenticalToCapturedTraces: true,
      outputBytesMatchCapturedTraceFile: afterHash === binding.expectedHashes.traces,
      limits: "No materialized candidate or manufactured hole reduction exists; no new optimization claim. Original captured output was independently qualified." }
  }
  assert(!result.unsupportedReason)
  const afterSites = viaSites(original, result.traces), afterStructure = copperStructure(original, result.traces)
  for (const [site, occurrences] of afterSites) {
    assert.equal(occurrences, beforeSites.get(site), "Via site invented or only partly deleted")
  }
  assert.equal(beforeSites.size - afterSites.size, result.removedViaSites, "Claim does not equal manufactured full-site deletion")
  assert.equal([...beforeSites.values()].reduce((sum, count) => sum + count, 0)
    - [...afterSites.values()].reduce((sum, count) => sum + count, 0), result.removedViaOccurrences)
  assert.deepEqual(afterStructure.wires, beforeStructure.wires, "Existing width-preserving wire copper changed")
  assert.deepEqual(afterStructure.terminalAnnotations, beforeStructure.terminalAnnotations, "Terminal endpoint attribution changed")
  assert.deepEqual(afterStructure.terminalReferences, beforeStructure.terminalReferences, "Declared terminal ownership references changed")
  const originalSource = binding.originalSourceCircuitJson
  assert(originalSource, "Hash-bound original source CJSON required")
  assert.equal(sha(readFileSync(originalSource.path, "utf8")), originalSource.sha256)
  const sourceCircuit = json(originalSource.path)
  assertIndependentDeletedDrillSafety(original, traces, beforeSites, afterSites, result.traces, sourceCircuit)
  const evaluate = (routedTraces: Json[]) => evaluateRelaxedDrc({ inputSrj: original,
    srjWithPointPairs: pairs, routedTraces, includeBoardClearance: true,
    drcOptions: { traceClearance: 0.1, holeClearance: original.minTraceToHoleEdgeClearance,
      includeTraceContinuity: true, includeTypedTraceClearance: true } })
  const referenceBefore = evaluate(traces), referenceAfter = evaluate(result.traces)
  assert.equal(referenceBefore.errors.length, 0)
  assert.equal(referenceAfter.errors.length, 0)
  const libraryBefore = await runAllRoutingChecks(structuredClone(referenceBefore.circuitJson))
  const libraryAfter = await runAllRoutingChecks(structuredClone(referenceAfter.circuitJson))
  assert.deepEqual(hardLibraryErrors(libraryAfter), hardLibraryErrors(libraryBefore), "Physical/connectivity library findings changed")
  assert.equal(libraryAfter.filter((error: Json) => error.type === "pcb_pad_pad_clearance_error").length, 0)
  const cjsonVias: Json[] = referenceAfter.circuitJson.filter((element: Json) => element.type === "pcb_via")
  for (const via of cjsonVias) {
    assert.deepEqual([...via.layers].sort(), [...stack].sort())
    assert.equal(via.outer_diameter, 0.3)
    assert.equal(via.hole_diameter, 0.15)
  }
  assert.deepEqual([...new Set(cjsonVias.map((via: Json) => JSON.stringify([via.x, via.y])))].sort(),
    [...new Set([...afterSites.keys()].map((site) => { const value = JSON.parse(site); return JSON.stringify([value[1], value[2]]) }))].sort(),
    "Materialized CJSON conversion lost or invented a via site")
  const srjAudit = auditRouteBundle(original, { routes: result.traces, format: "traces",
    field: "offline-prototype-materialized-traces", coordinateFrame: "world-mm" })
  assert.equal(srjAudit.findingCount, 0)
  assert.equal(srjAudit.unknownContactCount, 0, "Unresolved SRJ contacts prevent a qualified reduction")
  assert.equal(srjAudit.status, "COMPLETE")
  const sourceAudit = auditOriginalSourceViaPads(original, result.traces, sourceCircuit)
  assert.equal(sourceAudit.confirmedForeignViolationCount, 0)
  const sourceBefore = originalQualification.independentOriginalSourceViaPadAudit
  assert(sourceAudit.unresolvedNearOrUnboundContactCount <= sourceBefore.unresolvedNearOrUnboundContactCount,
    "New unsupported source geometry contact was introduced")
  const after = strictCopperMetrics(original, result.traces).summary
  assert.equal(after.unresolvedTraceOwners, 0)
  assert.equal(after.foreignOwnerCoincidentSites, 0)
  assert.equal(before.uniqueOwnedManufacturedSites - after.uniqueOwnedManufacturedSites, result.removedViaSites)
  return { ...base, status: "MATERIALIZED_REDUCTION_PASSED_UNCHANGED_REFERENCE_AND_STRICT_COPPER_CHECKS",
    originalOwnershipCopperAfter: after, outputCanonicalSerializationIdenticalToCapturedTraces: false,
    outputBytesMatchCapturedTraceFile: afterHash === binding.expectedHashes.traces,
    originalReferenceErrorCount: referenceAfter.errors.length,
    allLibraryFindingCountsBefore: findingCounts(libraryBefore), allLibraryFindingCountsAfter: findingCounts(libraryAfter),
    independentDeclaredSrjViaPadAudit: { status: srjAudit.status, findingCount: srjAudit.findingCount,
      unknownContactCount: srjAudit.unknownContactCount },
    independentOriginalSourceViaPadAudit: { status: sourceAudit.status,
      unsupportedSmtShapes: sourceAudit.unsupportedSmtShapes,
      unsupportedPlatedShapes: sourceAudit.unsupportedPlatedShapes,
      unboundPadGeometry: sourceAudit.unboundPadGeometry,
      confirmedForeignViolationCount: sourceAudit.confirmedForeignViolationCount,
      unresolvedNearOrUnboundContactCount: sourceAudit.unresolvedNearOrUnboundContactCount,
      globalOriginalSourceViaPadClearancePassed: sourceAudit.globalOriginalSourceViaPadClearancePassed },
    wireAndTerminalStructureSha256Before: jsonHash(beforeStructure), wireAndTerminalStructureSha256After: jsonHash(afterStructure),
    limits: "Unchanged conservative prototype only; no solver or production integration. Full sites and all occurrences must be deleted. Same-layer width-preserving wire copper and terminal attributes are invariant. Unsupported original source bodies remain explicit; this is not a global physical-signoff claim." }
}

if (import.meta.main) {
  assert(process.argv[2] && process.argv[3], "Usage: binding-manifest.json aggregate-report.json")
  const bindings: Json[] = json(process.argv[2]).bindings.filter((binding: Json) =>
    binding.sourceSha === "ee0dac23c8ff76fde81a0124bf444790a8394f25")
  assert(bindings.length > 0, "No qualified new camera captures supplied")
  const seen = new Map<string, Json>(), reports: Json[] = []
  for (const binding of bindings) {
    assertCameraCaptureScope(binding)
    const key = JSON.stringify([binding.expectedHashes.input, binding.expectedHashes.traces])
    const previous = seen.get(key)
    if (previous) {
      // Exact identical data invokes the same deterministic offline function;
      // this is shared geometry, not an independent reduction experiment.
      await auditCapturedSuccess(binding)
      reports.push({ label: binding.label, status: "IDENTICAL_QUALIFIED_GEOMETRY_ALIAS",
        aliasOf: previous.label, sourceInputSha256: binding.expectedHashes.input,
        sourceTracesSha256: binding.expectedHashes.traces, removedViaSites: previous.removedViaSites,
        removedViaOccurrences: previous.removedViaOccurrences })
      continue
    }
    const report = await auditPostrouteCapture(binding)
    reports.push(report)
    seen.set(key, report)
  }
  const output = { scope: "Read-only offline evaluation of unchanged prototype on exact qualified new captured copper; no new routing or timing", reports }
  writeFileSync(process.argv[3], JSON.stringify(output, null, 2) + "\n")
  console.log("COALESCED_POSTROUTE_SHARING_AUDIT_JSON " + JSON.stringify(output))
}
