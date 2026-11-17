import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { gzipSync } from "node:zlib"

assert.equal(Bun.version, "1.4.3")
assert(process.env.H616_ENTRY_IDENTITY && process.env.H616_CAPTURE_PATH)
assert(!process.env.BUN_UPDATE_SNAPSHOTS && !process.env.UPDATE_SNAPSHOTS)
const identity = JSON.parse(readFileSync(process.env.H616_ENTRY_IDENTITY, "utf8"))
const sourceBytes = readFileSync(identity.sourceEntry)
assert.equal(createHash("sha256").update(sourceBytes).digest("hex"), identity.sourceSha256)
// The fixture needs only this exact source class. Do not load the published
// wrapper and its unrelated solver registrations into the test process.
const { AutoroutingPipelineSolver9_PreloadedTraceGraph } = await import(pathToFileURL(identity.sourceEntry).href)
const originalOutput = AutoroutingPipelineSolver9_PreloadedTraceGraph.prototype.getOutputSimplifiedPcbTraces
assert.equal(typeof originalOutput, "function")
let captureCalls = 0
AutoroutingPipelineSolver9_PreloadedTraceGraph.prototype.getOutputSimplifiedPcbTraces = function (...args) {
  assert.equal(this.constructor, AutoroutingPipelineSolver9_PreloadedTraceGraph)
  assert.equal(args.length, 0)
  const routedTraces = originalOutput.apply(this, args)
  captureCalls++
  const coarse = this.portPointPathingSolver
  const packet = {
    sourceEntrySha256: identity.sourceSha256,
    exactSelectedConstructor: true,
    outputCaptureCalls: captureCalls,
    additionalOutputCalls: 0,
    solved: this.solved,
    failed: this.failed,
    error: this.error,
    iterations: this.iterations,
    srjWithPointPairs: this.srjWithPointPairs,
    routedTraces,
    coarse: coarse ? { className: coarse.constructor.name, iterations: coarse.iterations, stats: coarse.stats } : null,
  }
  writeFileSync(process.env.H616_CAPTURE_PATH, gzipSync(JSON.stringify(packet)))
  return routedTraces
}

export { AutoroutingPipelineSolver9_PreloadedTraceGraph }
