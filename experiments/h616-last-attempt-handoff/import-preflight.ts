import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { gunzipSync } from "node:zlib"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "./h616-selected-constructor.mjs"
import { createPipeline9AutoroutingDrcEvaluator } from "./lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9AutoroutingDrcEvaluator"
import { evaluateRelaxedDrc } from "./lib/testing/evaluate-relaxed-drc"
import { getBugReportSnapshotSvg } from "./lib/testing/getBugReportSnapshotSvg"

assert(process.env.H616_ENTRY_IDENTITY && process.env.H616_CAPTURE_PATH)
const identity = JSON.parse(readFileSync(process.env.H616_ENTRY_IDENTITY, "utf8"))
const exact = await import(pathToFileURL(identity.sourceEntry).href)
assert.equal(AutoroutingPipelineSolver9_PreloadedTraceGraph, exact.AutoroutingPipelineSolver9_PreloadedTraceGraph)
for (const helper of [createPipeline9AutoroutingDrcEvaluator, evaluateRelaxedDrc, getBugReportSnapshotSvg]) assert.equal(typeof helper, "function")
const fixture = JSON.parse(gunzipSync(readFileSync("tests/fixtures/assets/h616-full-board-ddr-clearance.json.gz")).toString("utf8"))
const solver = new AutoroutingPipelineSolver9_PreloadedTraceGraph(fixture.inputSrj, { cacheProvider: null })
assert.equal(solver.constructor, exact.AutoroutingPipelineSolver9_PreloadedTraceGraph)
assert.equal(solver.iterations, 0)
assert(!solver.solved && !solver.failed && !existsSync(process.env.H616_CAPTURE_PATH))
console.log("H616_IMPORT_PREFLIGHT " + JSON.stringify({ sourceEntrySha256: identity.sourceSha256, exactConstructor: true, nativeHelpersImported: true, solverStepped: false, outputCalled: false, bunVersion: Bun.version }))
