import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync, realpathSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  originalOwners,
  strictCopperMetrics,
} from "./audit-retention-fixed-artifact"
import { auditRouteBundle } from "./audit-retention-stage-geometry"
import { evaluateRelaxedDrc, combinePreloadedAndRoutedTraces } from "../../lib/testing/evaluate-relaxed-drc"
import { runAllRoutingChecks } from "@tscircuit/checks"
import { auditOriginalSourceViaPads } from "./audit-original-source-via-pads"

type Json = any
type Binding = {
  label: string
  campaignDirectory: string
  rawDirectory: string
  sourceSha: string
  controllerSha: string
  runId: string
  dataset: string
  sample: number
  round: number
  arm: "A" | "B"
  expectedOptions: Json
  expectedHashes: { input: string; output: string; traces: string }
  strictQualificationReceipt: { path: string; sha256: string }
  originalSourceCircuitJson?: { path: string; sha256: string }
}
const frozenRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const validatorHashes: Record<string, string> = {
  "lib/testing/evaluate-relaxed-drc.ts": "d774e4d05931e0e24b2462e9436c9b0aba604aafddc88c99e67e588a4c2fcd59",
  "lib/testing/getDrcErrors.ts": "8f3aba2532e216d530db5efe3d514ec114f33b4ac0e32d68170522660257a994",
  "lib/testing/drcPresets.ts": "28676dfc06a0ce9c31139d7e5745d872c8d27fe0c5f3972360a4fd1ce73518bf",
  "lib/testing/utils/convertToCircuitJson.ts": "ed6f4c1e7506c7aea52679dc52a0af80af8cacdfc638bb74c852208ba7e32212",
  "lib/testing/utils/migrate-legacy-obstacle-circuit-json-metadata.ts": "6ce2359e7c76d888cf9a8c91aee28750ea8b083ed09e6913b8446266bb779f13",
}
const sha = (data: string): string => createHash("sha256").update(data).digest("hex")
const fileHash = (path: string): string => sha(readFileSync(path, "utf8"))
const json = (path: string): Json => JSON.parse(readFileSync(path, "utf8"))
const fullLayers = ["top", "inner1", "inner2", "bottom"]
const countTypes = (errors: Json[]): Record<string, number> => {
  const counts: Record<string, number> = {}
  for (const error of errors) counts[error.type] = (counts[error.type] ?? 0) + 1
  return counts
}
const padErrorKeys = (errors: Json[]): string[] => errors
  .filter((error) => error.type === "pcb_pad_pad_clearance_error")
  .map((error) => JSON.stringify([error.type, [...error.pcb_pad_ids].sort(), error.message]))
  .sort()

export const auditCapturedSuccess = async (binding: Binding): Promise<Json> => {
  assert.equal(fileHash(binding.strictQualificationReceipt.path), binding.strictQualificationReceipt.sha256,
    "Strict benchmark qualification receipt changed")
  const provenance = json(join(binding.campaignDirectory, "provenance.json"))
  assert.equal(String(provenance.githubRunId), binding.runId)
  assert.equal(provenance.controllerSha, binding.controllerSha)
  assert.equal(provenance.dataset, binding.dataset)
  const harness = provenance.harnesses[binding.arm]
  assert.equal(harness.checkoutSha, binding.sourceSha)
  const canonicalRaw = join(binding.campaignDirectory,
    `round-${binding.round}/sample-${String(binding.sample).padStart(3, "0")}/${binding.arm}/raw`)
  assert.equal(realpathSync(binding.rawDirectory), realpathSync(canonicalRaw),
    "Raw capture is not the selected sample/arm inside the bound campaign")
  const rows = readFileSync(join(binding.campaignDirectory, "results.jsonl"), "utf8")
    .trim().split("\n").map((line) => JSON.parse(line))
    .filter((row) => row.sampleNumber === binding.sample && row.round === binding.round && row.arm === binding.arm)
  assert.equal(rows.length, 1, "Expected exactly one selected result row")
  const row = rows[0]
  assert.equal(row.sha, binding.sourceSha)
  assert.equal(row.dataset, binding.dataset)
  assert.equal(row.expectedInputHash, binding.expectedHashes.input)
  assert.equal(row.controllerError, null)
  assert.equal(row.supplementalValidationError, null)
  assert.equal(row.official.didSolve, true)
  assert.equal(row.official.didTimeout, false)
  assert.equal(row.official.relaxedDrcPassed, true)
  assert.equal(row.official.drcErrorCount, 0)
  assert.deepEqual(row.phaseCheckpointAudit.errors, [])
  const checkpoint = row.phaseCheckpointAudit.lastDurableCheckpoint
  assert.equal(checkpoint.algorithmSha, binding.sourceSha)
  assert.equal(String(checkpoint.githubRunId), binding.runId)
  assert.equal(checkpoint.controllerSha, binding.controllerSha)
  assert.equal(checkpoint.dataset, binding.dataset)
  assert.equal(checkpoint.originalSample, binding.sample)
  assert.equal(checkpoint.inputSha256, binding.expectedHashes.input)
  for (const [path, expected] of Object.entries(validatorHashes)) {
    assert.equal(fileHash(join(frozenRoot, path)), expected, `Local validator changed:${path}`)
    assert.equal(harness.validators[path], expected, `Captured validator changed:${path}`)
  }
  const dependencyHashes: Record<string, string> = {}
  for (const dependency of ["@tscircuit/checks", "circuit-json", "@tscircuit/math-utils",
    "@tscircuit/circuit-json-util", "circuit-json-to-connectivity-map", "high-density-repair03"]) {
    const expected = harness.dependencyResolution.directDependencies[dependency]
    assert(expected && !expected.missingPackageJson, `Missing frozen dependency:${dependency}`)
    const actual = fileHash(join(frozenRoot, "node_modules", dependency, "package.json"))
    assert.equal(actual, expected.packageJsonSha256, `Audit dependency changed:${dependency}`)
    dependencyHashes[dependency] = actual
  }
  assert.equal(fileHash(join(frozenRoot, "node_modules/@tscircuit/checks/dist/index.js")),
    "4d568a55512ee599df1422eda189b7c7bbbd1ed20bace1e9922033e12b938a6b")
  const raw = binding.rawDirectory
  for (const [name, expected] of [
    ["original-input.json", binding.expectedHashes.input],
    ["raw-solver-output.json", binding.expectedHashes.output],
    ["raw-new-traces.json", binding.expectedHashes.traces],
  ]) assert.equal(fileHash(join(raw, name)), expected, `Captured bytes changed:${name}`)
  const original = json(join(raw, "original-input.json"))
  const rawOutput = json(join(raw, "raw-solver-output.json"))
  const traces = json(join(raw, "raw-new-traces.json"))
  assert.deepEqual(rawOutput.traces, traces, "Raw solver output and captured new traces disagree")
  const pairs = json(join(raw, "point-pair-context.json"))
  const capture = json(join(raw, "capture-provenance.json"))
  const saved = json(join(raw, "supplemental-validation.json"))
  assert.equal(capture.inputHash, binding.expectedHashes.input)
  assert.equal(capture.rawOutputHash, binding.expectedHashes.output)
  assert.equal(capture.rawNewTracesHash, binding.expectedHashes.traces)
  assert.equal(capture.inputMutated, false)
  assert.equal(capture.solverSolved, true)
  assert.equal(capture.solverFailed, false)
  assert.equal(capture.solverError, null)
  assert.deepEqual(capture.options, binding.expectedOptions)
  for (const key of ["inputHash", "rawOutputHash", "rawNewTracesHash", "options",
    "solverSolved", "solverFailed", "solverError", "inputMutated"]) {
    assert.deepEqual(row.official.routingMetrics.experimentAudit[key], capture[key],
      `Selected row does not bind the raw capture:${key}`)
  }
  assert.equal(original.layerCount, 4)
  assert.notEqual(original.allowBlindAndBuriedVias, true)
  const allTraces = combinePreloadedAndRoutedTraces(original.traces ?? [], traces)
  const ownerMap = originalOwners(original)
  const rawViaCoordinates = new Set<string>()
  const originalOwnerLocalSpanSites = new Set<string>()
  let rawViaOccurrences = 0
  for (const trace of allTraces) {
    assert.equal(ownerMap.trace(trace).status, "resolved", "Original typed trace owner unresolved")
    for (const point of trace.route) {
      if (point.route_type !== "via") continue
      rawViaOccurrences++
      rawViaCoordinates.add(JSON.stringify([point.x, point.y]))
      const diameter = point.via_diameter ?? original.min_via_pad_diameter ?? original.minViaPadDiameter ?? original.minViaDiameter ?? 0.3
      const hole = point.via_hole_diameter ?? original.min_via_hole_diameter ?? original.minViaHoleDiameter ?? diameter * 0.5
      assert.equal(diameter, 0.3, "Unexpected manufactured via diameter")
      assert.equal(hole, 0.15, "Unexpected manufactured hole diameter")
      assert(fullLayers.includes(point.from_layer) && fullLayers.includes(point.to_layer) && point.from_layer !== point.to_layer)
      originalOwnerLocalSpanSites.add(JSON.stringify([ownerMap.trace(trace).owners[0], point.x, point.y,
        [point.from_layer, point.to_layer].sort((a, b) => fullLayers.indexOf(a) - fullLayers.indexOf(b)), diameter, hole]))
    }
  }
  const reference = evaluateRelaxedDrc({ inputSrj: original, srjWithPointPairs: pairs,
    routedTraces: traces, includeBoardClearance: true,
    drcOptions: { traceClearance: 0.1, holeClearance: original.minTraceToHoleEdgeClearance,
      includeTraceContinuity: true, includeTypedTraceClearance: true } })
  assert.equal(reference.errors.length, 0, "Original reference result did not reproduce")
  const library = await runAllRoutingChecks(structuredClone(reference.circuitJson))
  assert.deepEqual(padErrorKeys(library), padErrorKeys(saved.libraryRoutingChecks.errors),
    "Saved mandatory pad findings did not reproduce")
  const circuitVias: Json[] = reference.circuitJson.filter((element: Json) => element.type === "pcb_via")
  for (const via of circuitVias) {
    assert.deepEqual([...via.layers].sort(), [...fullLayers].sort(), "Via is not manufactured through all original layers")
    assert.equal(via.outer_diameter, 0.3)
    assert.equal(via.hole_diameter, 0.15)
  }
  assert.deepEqual([...new Set(circuitVias.map((via: Json) => JSON.stringify([via.x, via.y])))].sort(),
    [...rawViaCoordinates].sort(), "CJSON conversion lost or invented a manufactured via site")
  const copper = strictCopperMetrics(original, traces).summary
  assert.equal(copper.unresolvedTraceOwners, 0)
  assert.equal(copper.foreignOwnerCoincidentSites, 0)
  assert.equal(copper.emittedVias, rawViaOccurrences)
  const srjViaAudit = auditRouteBundle(original, { routes: allTraces, format: "traces",
    field: "qualified-final-original-owned-traces", coordinateFrame: "world-mm" })
  let sourceShapeInventory: Json = { status: "NOT_BOUND", unsupportedSourceSmtShapes: null }
  let originalSourceViaPadAudit: Json = { status: "NOT_BOUND", globalOriginalSourceViaPadClearancePassed: null }
  if (binding.originalSourceCircuitJson) {
    const source = binding.originalSourceCircuitJson
    assert.equal(fileHash(source.path), source.sha256)
    const elements = json(source.path)
    originalSourceViaPadAudit = auditOriginalSourceViaPads(original, allTraces, elements)
    const pads = elements.filter((element: Json) => element.type === "pcb_smtpad")
    const supported = (pad: Json): boolean => pad.shape === "circle" ||
      (pad.shape === "rect" && (pad.corner_radius ?? 0) === 0 && (pad.radius ?? 0) === 0)
    sourceShapeInventory = { status: "HASH_BOUND_INVENTORY_ONLY_NOT_A_COPPER_CLEARANCE_AUDIT",
      sha256: source.sha256, originalSmtPadCount: pads.length,
      shapeCounts: countTypes(pads.map((pad: Json) => ({ type: pad.shape }))),
      unsupportedSourceSmtShapes: pads.filter((pad: Json) => !supported(pad)).length }
  }
  return { label: binding.label, sourceSha: binding.sourceSha, runId: binding.runId,
    dataset: binding.dataset, sample: binding.sample, arm: binding.arm,
    status: "OFFLINE_CAPTURE_AUDITED_NO_SOLVER_RUN", hashes: binding.expectedHashes,
    validatorHashes, dependencyHashes, originalReferenceErrorCount: reference.errors.length,
    ancillaryArtifactHashes: Object.fromEntries([
      ["point-pair-context.json", fileHash(join(raw, "point-pair-context.json"))],
      ["capture-provenance.json", fileHash(join(raw, "capture-provenance.json"))],
      ["supplemental-validation.json", fileHash(join(raw, "supplemental-validation.json"))],
      ["campaign-provenance.json", fileHash(join(binding.campaignDirectory, "provenance.json"))],
      ["campaign-results.jsonl", fileHash(join(binding.campaignDirectory, "results.jsonl"))],
    ]),
    mandatoryLibraryPadErrorCount: library.filter((error: Json) => error.type === "pcb_pad_pad_clearance_error").length,
    allLibraryFindingCounts: countTypes(library), originalOwnershipCopper: copper,
    manufacturedViaSpan: fullLayers, manufacturedViaDiameterMm: 0.3, manufacturedHoleDiameterMm: 0.15,
    emittedCircuitJsonViaCount: circuitVias.length,
    genericCapturedLocalSpanViaSites: saved.physicalCopper.uniqueOwnedViaSiteSpanCount,
    independentOriginalOwnerLocalSpanSites: originalOwnerLocalSpanSites.size,
    independentFullManufacturedSpanViaSites: copper.uniqueOwnedManufacturedSites,
    pureLocalSpanSplittingSiteOvercount: originalOwnerLocalSpanSites.size - copper.uniqueOwnedManufacturedSites,
    localSpanMetricMinusManufacturedSiteMetric: saved.physicalCopper.uniqueOwnedViaSiteSpanCount - copper.uniqueOwnedManufacturedSites,
    physicalSiteKeyDefinition: "Unrounded original typed owner+XY+ALL_FOUR_MANUFACTURED_LAYERS+0.3pad/0.15hole; local route transition endpoints do not split a drilled site",
    independentDeclaredSrjViaPadAudit: srjViaAudit, originalSourceShapeInventory: sourceShapeInventory,
    independentOriginalSourceViaPadAudit: originalSourceViaPadAudit,
    limits: ["Mandatory library checks use the unchanged SRJ-to-CJSON reconstruction, not full original source CJSON.",
      "The controller qualification receipt is hash-bound separately; this audit also binds the exact selected successful row and captured raw bytes.",
      "The independent via audit covers declared SRJ geometry and reports unresolved contact geometry; source-shape inventory is separate.",
      "Wire length includes raw same-layer length and exact width-preserving segment deduplication, not a partial-overlap geometric union.",
      "Physical/site metrics are independent of benchmark speed; no new routing or timing was performed."] }
}

if (import.meta.main) {
  assert(process.argv[2] && process.argv[3], "Usage: binding-manifest.json report.json")
  const bindings: Binding[] = json(process.argv[2]).bindings
  assert(bindings.length > 0, "No successful captures supplied")
  const reports = []
  for (const binding of bindings) reports.push(await auditCapturedSuccess(binding))
  const output = { scope: "Read-only exact captured copper audit; no solver runs or benchmark timing", reports }
  writeFileSync(process.argv[3], JSON.stringify(output, null, 2) + "\n")
  console.log("COALESCED_CAPTURED_COPPER_AUDIT_JSON " + JSON.stringify(reports.map((report) => ({ label: report.label,
    referenceErrors: report.originalReferenceErrorCount, padErrors: report.mandatoryLibraryPadErrorCount,
    physicalSites: report.originalOwnershipCopper.uniqueOwnedManufacturedSites,
    srjAuditStatus: report.independentDeclaredSrjViaPadAudit.status,
    srjUnknownContacts: report.independentDeclaredSrjViaPadAudit.unknownContactCount,
    unsupportedSourceShapes: report.originalSourceShapeInventory.unsupportedSourceSmtShapes }))))
}
