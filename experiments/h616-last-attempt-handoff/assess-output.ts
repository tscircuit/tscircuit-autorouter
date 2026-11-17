import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { gunzipSync, gzipSync } from "node:zlib"
import { createPipeline9AutoroutingDrcEvaluator } from "./lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9AutoroutingDrcEvaluator"
import { evaluateRelaxedDrc } from "./lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "./lib/testing/getBugReportSnapshotSvg"

const [output] = process.argv.slice(2)
assert(output && Bun.version === "1.4.3")
const fixtureBytes = readFileSync("tests/fixtures/assets/h616-full-board-ddr-clearance.json.gz")
assert.equal(createHash("sha256").update(fixtureBytes).digest("hex"), "17c1e7600ff14d4c26bee27ef76941603493bcc2a1607505c6cf26990dc141f1")
const fixture = JSON.parse(gunzipSync(fixtureBytes).toString("utf8"))
const capture = JSON.parse(gunzipSync(readFileSync(join(output, "actual-output.json.gz"))).toString("utf8"))
assert(capture.exactSelectedConstructor && capture.solved && !capture.failed)
assert.equal(capture.outputCaptureCalls, 1)
assert.equal(capture.additionalOutputCalls, 0)
const referenceSrj = {
  ...fixture.inputSrj,
  obstacles: fixture.nativeObstacles,
  connections: [...fixture.preloadedConnections, ...fixture.inputSrj.connections],
  traces: fixture.preloadedTraces,
}
const snapshotInput = {
  inputSrj: referenceSrj,
  srjWithPointPairs: {
    ...capture.srjWithPointPairs,
    connections: [...fixture.preloadedConnections, ...capture.srjWithPointPairs.connections],
  },
  routedTraces: capture.routedTraces,
  drcOptions: { traceClearance: 0.1, viaToPadClearance: 0.1 },
}
const nativeDrc = evaluateRelaxedDrc(snapshotInput)
// Keep the original test's separate placement evaluator call unchanged: it
// intentionally does not receive the snapshot's native DRC overrides.
const evaluate = createPipeline9AutoroutingDrcEvaluator({
  inputSrj: referenceSrj,
  srjWithPointPairs: snapshotInput.srjWithPointPairs,
})
const placementErrors = evaluate(snapshotInput.routedTraces).errors.filter((error) => error.type === "pcb_placement_error")
const svg = getBugReportSnapshotSvg(snapshotInput)
const copper = JSON.stringify(capture.routedTraces)
const pointPairs = JSON.stringify(capture.srjWithPointPairs)
const circuitJson = JSON.stringify(nativeDrc.circuitJson)
writeFileSync(join(output, "native.svg"), svg)
writeFileSync(join(output, "native-drc.json.gz"), gzipSync(JSON.stringify({ errors: nativeDrc.errors, placementErrors })))
const result = {
  sourceEntrySha256: capture.sourceEntrySha256,
  solved: capture.solved,
  failed: capture.failed,
  nativeDrcErrors: nativeDrc.errors.length,
  placementErrors: placementErrors.length,
  outputTraceCount: capture.routedTraces.length,
  outputCopperSha256: createHash("sha256").update(copper).digest("hex"),
  pointPairsSha256: createHash("sha256").update(pointPairs).digest("hex"),
  nativeCircuitJsonSha256: createHash("sha256").update(circuitJson).digest("hex"),
  nativeSvgSha256: createHash("sha256").update(svg).digest("hex"),
  coarse: capture.coarse,
  routingExecutedDuringAssessment: false,
}
writeFileSync(join(output, "assessment.json"), JSON.stringify(result, null, 2) + "\n")
console.log("H616_NATIVE_ASSESSMENT " + JSON.stringify(result))
assert(nativeDrc.errors.length < 44, "Existing native DRC bound failed")
assert.equal(placementErrors.length, 0, "Existing placement-error assertion failed")
