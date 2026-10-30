import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createPhaseCheckpointObserver } from "../phase-checkpoint-observer"

// One synthetic transport control exercises the actual unchanged checkpoint and
// terminal extractors. No routing, checker, certificate, or board is executed.
const paths = ["netToPointPairsSolver.layerAwareMstStats", "relativeWitnessRepairSolver.qualification", "relativeWitnessRepairSolver.stats", "relativeWitnessRepairSolver.relativeProof"]
const directory = mkdtempSync(join(tmpdir(), "mst-relative-v4-observer-"))
const priorConfig = process.env.EXPERIMENT_AUDIT_CONFIG
const priorOutput = process.env.EXPERIMENT_AUDIT_OUTPUT
let getterCalls = 0
let maxRowBytes = 0
let checkpointRows = 0
const modes = ["ABSENT", "UNINITIALIZED", "NO_PROPOSAL", "SEARCH_EXHAUSTED_UNCHANGED", "LOCAL_REPAIRED", "INCREMENTAL_REPAIRED"]

class SyntheticObserverSolver {
  opts: Record<string, unknown>
  cacheProvider = null
  pipelineDef = [{ solverName: "relativeWitnessRepairSolver" }]
  currentPipelineStepIndex = 0
  activeSubSolver = null
  iterations = 1000000000
  MAX_ITERATIONS = 1000000000
  solved = true
  failed = false
  error = null
  netToPointPairsSolver: unknown
  relativeWitnessRepairSolver: unknown
  constructor(scenario: any, options: Record<string, unknown>) {
    this.opts = options
    this.netToPointPairsSolver = scenario.mst
    this.relativeWitnessRepairSolver = scenario.relative
  }
  _step(): void {}
  getOutput(): never { getterCalls++; throw new Error("Serializer invoked an output getter") }
}

try {
  const fixtureModule = join(directory, "constructor-fixture.ts")
  writeFileSync(fixtureModule, "export class SyntheticObserverSolver {}\n")
  const sourceHash = createHash("sha256").update(readFileSync(new URL("../phase-checkpoint-observer.ts", import.meta.url))).digest("hex")
  const options = { cacheProvider: null, effort: 1, experimentLayerAwareMstIdentity: true, experimentRelativeWitnessRepair: true }
  const metadata = { campaign: "mst-relative-v4-84-20261030:srj24:26:BA", arm: "B", algorithmSha: "a".repeat(40), githubRunId: "99999999999", controllerSha: "b".repeat(40), dataset: "srj24", originalSample: 26, inputSha256: "c".repeat(64), executionOrder: "BA", observedObjectPath: "solver", observedConstructorName: "AutoroutingPipelineSolver9_PreloadedTraceGraph", observedRequestedOptions: options, actualCacheProviderState: "disabled" }
  const configFile = join(directory, "audit-config.json")
  writeFileSync(configFile, JSON.stringify({ solverName: "SyntheticObserverSolver", solverModule: fixtureModule, options, evidencePaths: paths, phaseCheckpoint: { observerSourceSha256: sourceHash, campaign: metadata.campaign, algorithmSha: metadata.algorithmSha, arm: "B", githubRunId: metadata.githubRunId, controllerSha: metadata.controllerSha, executionOrder: "BA" } }))
  process.env.EXPERIMENT_AUDIT_CONFIG = configFile
  process.env.EXPERIMENT_AUDIT_OUTPUT = directory
  const adapter = await import("../experiment-audit-adapter")

  for (const mode of modes) {
    const active = mode !== "ABSENT"
    const incremental = mode === "INCREMENTAL_REPAIRED"
    const repaired = mode === "LOCAL_REPAIRED" || incremental
    const sourceStatus = incremental ? "LOCAL_REPAIRED" : mode
    const qualification = { status: sourceStatus, localRepaired: repaired, accepted: false, initialFullCertificateStatus: "UNKNOWN", finalFullCertificateStatus: "UNKNOWN", relativeStatus: repaired ? "PASS" : "UNKNOWN", proposals: repaired ? 1 : mode === "SEARCH_EXHAUSTED_UNCHANGED" ? 16 : 0, beforeGeometryFindings: mode === "UNINITIALIZED" ? null : incremental ? 8 : 4, afterGeometryFindings: mode === "UNINITIALIZED" ? null : incremental ? 7 : repaired ? 0 : 4, protectedUnchanged: mode !== "UNINITIALIZED" }
    const stats = { status: sourceStatus, certificateChecks: repaired ? 2 : mode === "SEARCH_EXHAUSTED_UNCHANGED" ? 17 : 1, proposalCount: qualification.proposals, localRepaired: repaired, globalAccepted: false, candidateLedger: [{ nested: "this array is not scalar evidence" }], reason: "r".repeat(384), rejectionCounts: { geometry: 16 }, ...(incremental ? { acceptanceMode: "EXACT_UNTARGETED_FINDINGS", targetFindingCountBefore: 1, targetFindingCountAfter: 0, untargetedFindingsPreserved: true } : {}) }
    const proof = { status: "PASS", reason: "Each connected replacement bundle preserves exactly its fixed copper interfaces; global connectivity remains independently reported", bundleCount: 2, boundaryCount: 4, primitivePairs: 19038 }
    const mst = { layerAwareMstStats: { completed: true, connectionsProcessed: 1000000000, inputPointOccurrences: 1000000000, inputDistinctLayerKeys: 1000000000, mstCoveredLayerKeys: 1000000000, missingLayerKeys: 0, coincidentCrossLayerGroups: 1000000000, zeroDistanceLayerEdges: 1000000000, mstSelectedEdges: 1000000000 } }
    const relative: any = active ? { qualification, stats, relativeProof: repaired ? proof : undefined } : undefined
    if (relative) Object.defineProperty(relative, "selectedMoves", { enumerable: true, get() { getterCalls++; throw new Error("Serializer walked selected moves") } })
    const task: any = { datasetName: "synthetic", sampleNumber: 1, scenario: { mst, relative } }
    // Keep the guard getter off the adapter's cloned synthetic input.
    const adapterTask: any = { ...task, scenario: { mst, relative: active ? { qualification, stats, relativeProof: repaired ? proof : undefined } : undefined } }
    const solver = adapter.createExperimentAuditSolver(SyntheticObserverSolver, adapterTask, {})
    solver.relativeWitnessRepairSolver = relative
    const terminal: any = adapter.getExperimentAuditEvidence(solver, adapterTask).evidence
    const rows: any[] = []
    const observer = createPhaseCheckpointObserver({ outputDirectory: directory, sourceSha256: sourceHash, evidencePaths: paths, metadata, append: (_path, text) => { maxRowBytes = Math.max(maxRowBytes, Buffer.byteLength(text)); rows.push(JSON.parse(text)); checkpointRows++ } })
    observer.constructorEnter(); observer.install(solver); observer.solveEnter(performance.now()); solver._step(); observer.solveExit()
    assert.deepEqual(observer.getStatus().errors, [])
    assert.equal(observer.getStatus().truncated, false)
    assert.deepEqual(terminal[paths[0]!], mst.layerAwareMstStats)
    assert.deepEqual(terminal[paths[1]!], active ? qualification : null)
    assert.deepEqual(terminal[paths[3]!], repaired ? proof : null)
    assert.equal(Object.keys(terminal).length, 4)
    if (active) {
      assert.equal(Object.hasOwn(terminal[paths[2]!], "candidateLedger"), false)
      assert.equal(Object.hasOwn(terminal[paths[2]!], "rejectionCounts"), false)
      for (const [key, value] of Object.entries(stats)) if (!['candidateLedger', 'rejectionCounts'].includes(key)) assert.deepEqual(terminal[paths[2]!][key], value)
    } else assert.equal(terminal[paths[2]!], null)
    for (const row of rows.slice(1)) {
      assert.equal(row.evidenceOmittedForRowLimit, undefined)
      assert.equal(Object.keys(row.evidence).length, 4)
      assert.deepEqual(row.evidence[paths[0]!], mst.layerAwareMstStats)
      assert.deepEqual(row.evidence[paths[1]!], active ? qualification : null)
      assert.deepEqual(row.evidence[paths[3]!], repaired ? proof : null)
      if (active) {
        assert.equal(row.evidence[paths[2]!].candidateLedger, null)
        assert.equal(row.evidence[paths[2]!].rejectionCounts, null)
      } else assert.equal(row.evidence[paths[2]!], null)
    }
  }
  assert.equal(getterCalls, 0)
  assert(maxRowBytes <= 4096)
  console.log(JSON.stringify({ status: "PASS_FROZEN_CHECKPOINT_AND_TERMINAL_FOUR_FLAT_PATHS_NESTED_DATA_NOT_CLAIMED", runtime: Bun.version, modes: modes.length, checkpointRows, maxRowBytes, getterCalls, realBoards: 0 }))
} finally {
  if (priorConfig === undefined) delete process.env.EXPERIMENT_AUDIT_CONFIG
  else process.env.EXPERIMENT_AUDIT_CONFIG = priorConfig
  if (priorOutput === undefined) delete process.env.EXPERIMENT_AUDIT_OUTPUT
  else process.env.EXPERIMENT_AUDIT_OUTPUT = priorOutput
  rmSync(directory, { recursive: true, force: true })
}
