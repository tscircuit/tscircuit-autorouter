import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { auditCapturedSuccess } from "./audit-coalesced-captured-success"
import { auditOriginalSourceViaPadOverlay } from "./auditOriginalSourceViaPadOverlay"
import { evaluateRelaxedDrc } from "../../lib/testing/evaluate-relaxed-drc"

type Json = any
const json = (path: string): Json => JSON.parse(readFileSync(path, "utf8"))
const sha = (text: string): string => createHash("sha256").update(text).digest("hex")
const canonical = (value: Json): string => JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))))
const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
assert(process.argv[2] && process.argv[3] && process.argv[4], "Expected bindings, immutable qualified cases and output report")
const bindings = json(process.argv[2]).bindings
const cases = json(process.argv[3]).artifacts.flatMap((artifact: Json) => artifact.records)
assert.equal(sha(readFileSync(join(sourceRoot, "node_modules/@tscircuit/checks/dist/index.js"), "utf8")),
  "4d568a55512ee599df1422eda189b7c7bbbd1ed20bace1e9922033e12b938a6b", "Pinned checker bytes changed")
assert.equal(sha(readFileSync(join(sourceRoot, "node_modules/@tscircuit/circuit-json-util/dist/index.js"), "utf8")),
  "03c7e83c932ecadcb2cb74010358b421d1ce64533031dce27e4b7f7c42a0d2fe", "Pinned geometry dependency bytes changed")
const reports: Json[] = [], seen = new Map<string, Json>()
for (const binding of bindings) {
  const matched = cases.filter((candidate: Json) => String(candidate.runId) === String(binding.runId) &&
    candidate.controllerSha === binding.controllerSha && candidate.dataset === binding.dataset &&
    candidate.sample === binding.sample && candidate.arm === binding.arm && candidate.sourceSha === binding.sourceSha &&
    canonical(candidate.options) === canonical(binding.expectedOptions))
  assert.equal(matched.length, 1, "Selected source-overlay case identity is not unique")
  const expected = matched[0]
  assert.equal(binding.expectedHashes.input, expected.expectedInputHash)
  assert.equal(binding.expectedHashes.traces, expected.tracesHash)
  assert.equal(binding.expectedHashes.output, expected.outputHash)
  const prior = await auditCapturedSuccess(binding)
  const originalSrjText = readFileSync(join(binding.rawDirectory, "original-input.json"), "utf8")
  const originalTracesText = readFileSync(join(binding.rawDirectory, "raw-new-traces.json"), "utf8")
  const sourceCircuitJsonText = readFileSync(binding.originalSourceCircuitJson.path, "utf8")
  const original = JSON.parse(originalSrjText), traces = JSON.parse(originalTracesText)
  const sourceIdentity = expected.originalSourceCircuitJson
  assert.equal(binding.originalSourceCircuitJson.sha256, sourceIdentity.sha256)
  assert.equal(original.sourceCircuitJson, sourceIdentity.relativePath)
  const identity = JSON.stringify([expected.expectedInputHash, expected.tracesHash, sourceIdentity.sha256])
  const common = { label: binding.label, sourceSha: binding.sourceSha, dataset: binding.dataset,
    sample: binding.sample, arm: binding.arm, runId: binding.runId, controllerSha: binding.controllerSha,
    inputSha256: expected.expectedInputHash, tracesSha256: expected.tracesHash,
    sourceCircuitJsonSha256: sourceIdentity.sha256,
    existingMandatoryReferenceErrors: prior.originalReferenceErrorCount,
    existingMandatoryReconstructedPadErrors: prior.mandatoryLibraryPadErrorCount,
    existingFullManufacturedSites: prior.independentFullManufacturedSpanViaSites,
    existingPartialCustomSourceAuditStatus: prior.independentOriginalSourceViaPadAudit.status,
    existingPartialCustomSourceUnresolvedPairs: prior.independentOriginalSourceViaPadAudit.unresolvedNearOrUnboundContactCount }
  if (seen.has(identity)) {
    const previous = seen.get(identity)!
    reports.push({ ...common, status: "IDENTICAL_HASH_BOUND_SOURCE_AND_OUTPUT_ALIAS",
      aliasOf: previous.label, supplementalOriginalGeometryResult: previous.supplementalOriginalGeometryResult })
    continue
  }
  const pairs = json(join(binding.rawDirectory, "point-pair-context.json"))
  const materialized = evaluateRelaxedDrc({ inputSrj: original, srjWithPointPairs: pairs,
    routedTraces: traces, includeBoardClearance: true,
    drcOptions: { traceClearance: 0.1, holeClearance: original.minTraceToHoleEdgeClearance,
      includeTraceContinuity: true, includeTypedTraceClearance: true } })
  assert.equal(materialized.errors.length, 0, "Original reference materialization changed")
  const vias = materialized.circuitJson.filter((element: Json) => element.type === "pcb_via")
  assert.equal(vias.length, prior.emittedCircuitJsonViaCount, "Materialized output via count changed")
  const minClearance = original.minViaEdgeToPadEdgeClearance ?? 0.1
  assert.equal(minClearance, 0.1, "Original selected via rule changed")
  const result = auditOriginalSourceViaPadOverlay({ originalSrjText, originalTracesText, sourceCircuitJsonText,
    expectedInputSha256: expected.expectedInputHash, expectedTracesSha256: expected.tracesHash,
    expectedSourceSha256: sourceIdentity.sha256, expectedSourceReference: sourceIdentity.relativePath,
    materializedVias: vias, minClearance })
  const report = { ...common, status: "SUPPLEMENTAL_SAME_CHECKER_ORIGINAL_SOURCE_GEOMETRY_AUDITED",
    supplementalOriginalGeometryResult: result }
  reports.push(report)
  seen.set(identity, report)
}
const output = { scope: "ADDITIVE validation only: SAME pinned checker on original-authored source pad geometry; original mandatory validators, payloads and first audit findings remain unchanged",
  noRouterOrBenchmarkRun: true, checkerDistSha256: "4d568a55512ee599df1422eda189b7c7bbbd1ed20bace1e9922033e12b938a6b",
  geometryDistSha256: "03c7e83c932ecadcb2cb74010358b421d1ce64533031dce27e4b7f7c42a0d2fe",
  qualifiedCapturedRecords: reports.length, distinctInputTraceSourceHashCases: seen.size, reports }
writeFileSync(process.argv[4], JSON.stringify(output, null, 2) + "\n")
