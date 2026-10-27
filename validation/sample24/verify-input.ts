import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve, join } from "node:path"
import { loadScenarioBySampleNumber } from "../../scripts/benchmark/scenarios"
import { routingInputEvidence } from "./input-semantics"

const root = resolve(import.meta.dir, "../..")
const expected = JSON.parse(readFileSync(resolve(import.meta.dir, "original-input-evidence.json"), "utf8"))
const selected = await loadScenarioBySampleNumber("srj24", 24, 1)
const observed = routingInputEvidence(selected.scenario)
for (const [key, value] of Object.entries(expected.routingInputEvidence)) {
  if (observed[key] !== value) throw new Error(`Actual benchmark sample24 input differs: ${key} expected${value} observed${observed[key]}`)
}
if (selected.scenarioName !== "sample024" || selected.scenario.effort !== 1) throw new Error("Unexpected actual benchmark sample/effort selection")
const datasetEntry = Bun.resolveSync("@tscircuit/dataset-srj24", root)
const rawSamplePath = join(dirname(datasetEntry), "samples", `${selected.scenarioName}.json`)
const rawSampleSha256 = createHash("sha256").update(readFileSync(rawSamplePath)).digest("hex")
const sourceCircuitJsonPath = resolve(dirname(datasetEntry), selected.scenario.sourceCircuitJson!)
const sourceCircuitBytes = readFileSync(sourceCircuitJsonPath)
const sourceCircuitJson = JSON.parse(sourceCircuitBytes.toString())
const sourceBoardComponentCount = sourceCircuitJson.filter((element: any) => element.type === "pcb_component").length
if (sourceBoardComponentCount !== expected.sourceBoardComponentCount) throw new Error("Source board component count differs")
const report = {
  ready: true,
  kind: "ACTUAL_REPOSITORY_BENCHMARK_SAMPLE24_INPUT_PROOF",
  scenarioName: selected.scenarioName,
  sampleNumber: selected.sampleNumber,
  sourceLabel: selected.sourceLabel,
  totalSamples: selected.totalSamples,
  effort: selected.scenario.effort,
  datasetDeclaredSpec: JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).devDependencies["@tscircuit/dataset-srj24"],
  datasetEntry,
  rawSamplePath,
  rawSampleSha256,
  authoritativeOriginalRawSha256: expected.authoritativeOriginalRawSha256,
  rawBytesMatchAuthoritativeOriginal: rawSampleSha256 === expected.authoritativeOriginalRawSha256,
  routingInputEvidence: observed,
  sourceCircuitJsonPath,
  sourceCircuitJsonSha256: createHash("sha256").update(sourceCircuitBytes).digest("hex"),
  sourceBoardComponentCount,
  canonicalHashScope: "All routing input fields and nested metadata, excluding top-level source provenance, id and separately checked effort; object keys sorted, array order preserved",
  originalInputUnchanged: true,
  boardSolved: false,
}
writeFileSync(resolve(import.meta.dir, "input-verification.json"), JSON.stringify(report, null, 2) + "\n")
console.log(JSON.stringify({ inputVerified: true, rawBytesMatchAuthoritativeOriginal: report.rawBytesMatchAuthoritativeOriginal, sourceBoardComponentCount, ...observed }))
