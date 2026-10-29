import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createPhaseCheckpointObserver } from "../phase-checkpoint-observer"

// Tiny frozen-source final-stage control only; no actual dataset or full routing.
const sourceRoot = resolve(process.argv[2]!)
const outputPath = resolve(process.argv[3]!)
const sourceTree = execFileSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: sourceRoot, encoding: "utf8" }).trim()
assert.equal(sourceTree, "83d39c038ba8bdbb01fc53728e5069fd594d2d23")
assert.equal(Bun.version, "1.4.2")
const { AutoroutingPipelineSolver9_PreloadedTraceGraph: Pipeline } = await import(join(sourceRoot, "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph.ts"))
const { witnessViaPadRepairFixture } = await import(join(sourceRoot, "tests/features/witnessViaPadRepairFixture.ts"))
const input = witnessViaPadRepairFixture()
input.originalSrj.allowViaInPad = true
input.pointPairs.allowViaInPad = true
const pipeline = new Pipeline(input.originalSrj, { cacheProvider: null, effort: 1, experimentWitnessViaPadRepair: true })
Object.assign(pipeline, { powerTraceExpansionSolver: { solved: true, inputSrj: { fixedTraces: [] }, getOutput: () => input.traces }, srjWithPointPairs: input.pointPairs })
pipeline.currentPipelineStepIndex = pipeline.pipelineDef.length - 1
const paths = ["witnessViaPadRepairSolver.stats", "witnessViaPadRepairSolver.qualification", "witnessViaPadRepairSolver.stats.reasons.0", "witnessViaPadRepairSolver.stats.lastRejectionReasons.0"]
const observerSourceSha256 = createHash("sha256").update(readFileSync(new URL("../phase-checkpoint-observer.ts", import.meta.url))).digest("hex")
assert.equal(observerSourceSha256, "4541d446ad7c26e9900562e525c98c8d9bba19400d4574f2931d9fc4237c2294")
const rows: any[] = []
const directory = mkdtempSync(join(tmpdir(), "quality6-source-unknown-"))
try {
  const observer = createPhaseCheckpointObserver({ outputDirectory: directory, sourceSha256: observerSourceSha256, evidencePaths: paths, metadata: { campaign: "quality6-source-synthetic-unknown", algorithmSha: "2109f9e96957c06f23aef2b079f6d59fba23ea52", inputSha256: createHash("sha256").update(JSON.stringify(input.originalSrj)).digest("hex"), dataset: "synthetic", originalSample: 1, arm: "B", executionOrder: "AB", githubRunId: "1", controllerSha: "c".repeat(40) }, append: (_path, text) => rows.push(JSON.parse(text)) })
  observer.install(pipeline); observer.solveEnter(performance.now()); pipeline.solve(); observer.solveExit()
  assert.deepEqual(observer.getStatus().errors, []); assert.equal(observer.getStatus().truncated, false)
  const evidence = rows.at(-1).evidence
  assert.equal(pipeline.solved, true); assert.equal(pipeline.failed, false)
  assert.equal(pipeline.witnessViaPadRepairSolver.getOutput(), input.traces)
  assert.equal(evidence[paths[1]!].lastReferenceErrors, -1)
  assert.deepEqual(evidence[paths[1]!], pipeline.witnessViaPadRepairSolver.qualification)
  const fixture = { runtime: Bun.version, sourceTree, publishedSourceSha: "2109f9e96957c06f23aef2b079f6d59fba23ea52", observerSourceSha256, syntheticOnly: true, actualDatasetBoards: 0, trigger: "Explicit allowViaInPad:true is outside this experiment certificate scope", sourceSolved: pipeline.solved, sourceFailed: pipeline.failed, outputSameObject: true, observerErrors: observer.getStatus().errors, maxObserverRowBytes: Math.max(...rows.map((row) => Buffer.byteLength(JSON.stringify(row)) + 1)), events: rows.map((row) => row.event), evidence }
  writeFileSync(outputPath, JSON.stringify(fixture, null, 2) + "\n")
  console.log(JSON.stringify({ status: "PASS_ACTUAL_FROZEN_SOURCE_UNKNOWN_SENTINEL_THROUGH_FROZEN_OBSERVER", outputPath, sourceTree, runtime: Bun.version, realBoards: 0 }))
} finally { rmSync(directory, { recursive: true, force: true }) }
