import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createPhaseCheckpointObserver } from "../phase-checkpoint-observer"

// One synthetic control of the real frozen extractors; no router or checker.
const role = process.argv[2] ?? "F"
assert(["N", "P", "F"].includes(role))
const paths = ["netToPointPairsSolver.layerAwareMstStats", "pipeline9JointDrcRepairSolver.stats.originalOwnerCopperFeedback"]
const directory = mkdtempSync(join(tmpdir(), "feedback-observer-"))
const previousConfig = process.env.EXPERIMENT_AUDIT_CONFIG
const previousOutput = process.env.EXPERIMENT_AUDIT_OUTPUT
let maxRowBytes = 0
let rowsWritten = 0
let getterCalls = 0
class SyntheticFeedbackSolver {
  opts: unknown; cacheProvider = null; solved = true; failed = false; error = null
  pipelineDef = [{ solverName: "pipeline9JointDrcRepairSolver" }]
  currentPipelineStepIndex = 0; activeSubSolver = null; iterations = 1; MAX_ITERATIONS = 1000000000
  netToPointPairsSolver: unknown; pipeline9JointDrcRepairSolver: unknown
  constructor(input: any, options: unknown) { this.opts = options; this.netToPointPairsSolver = input.mst; this.pipeline9JointDrcRepairSolver = input.joint }
  _step(): void {}
  getOutput(): never { getterCalls++; throw new Error("Observer called an output getter") }
}
try {
  const module = join(directory, "fixture.ts"), config = join(directory, "config.json")
  writeFileSync(module, "export class SyntheticFeedbackSolver {}\n")
  const sourceHash = createHash("sha256").update(readFileSync(new URL("../phase-checkpoint-observer.ts", import.meta.url))).digest("hex")
  const options = { cacheProvider: null, effort: 1, ...(role === "N" ? {} : { experimentLayerAwareMstIdentity: true, experimentOriginalOwnerCopperFeedback: true }) }
  const metadata = { campaign: "owner-root-memo126-20261030:srj24:shard-0:case-8:FPN", arm: role, algorithmSha: "a".repeat(40), githubRunId: "99999999999", controllerSha: "b".repeat(40), dataset: "srj24", originalSample: 8, inputSha256: "c".repeat(64), executionOrder: "FPN", observedObjectPath: "solver", observedConstructorName: "AutoroutingPipelineSolver9_PreloadedTraceGraph", actualCacheProviderState: "disabled", observedRequestedOptions: options }
  writeFileSync(config, JSON.stringify({ solverName: "SyntheticFeedbackSolver", solverModule: module, options, evidencePaths: paths, phaseCheckpoint: { observerSourceSha256: sourceHash, campaign: metadata.campaign, algorithmSha: metadata.algorithmSha, arm: role, githubRunId: metadata.githubRunId, controllerSha: metadata.controllerSha, executionOrder: "FPN" } }))
  process.env.EXPERIMENT_AUDIT_CONFIG = config; process.env.EXPERIMENT_AUDIT_OUTPUT = directory
  const adapter = await import("../experiment-audit-adapter")
  for (const mode of ["UNREACHED", "SUPPORTED", "NOT_APPLICABLE"]) {
    const ledger: any = { version: 2, enabled: true, status: mode, reason: mode === "NOT_APPLICABLE" ? "r".repeat(384) : null, originalOwnershipCoverage: mode === "NOT_APPLICABLE" ? "UNKNOWN" : "COMPLETE", selectedCheckCount: 2, completePredicateSuite: mode === "SUPPORTED", baselineIssueCount: mode === "SUPPORTED" ? 1000000000 : null, initialIssueCount: mode === "SUPPORTED" ? 1000000000 : null, referenceEvaluations: 1000000000, appendedIssueCount: 1000000000, baselineMatchesFiltered: 1000000000, unsupportedOwnerCount: mode === "SUPPORTED" ? 0 : 1000000000, latestIssueCount: mode === "SUPPORTED" ? 0 : null }
    if (role !== "N") { ledger.completeAdmissionPredicateSuite = ledger.completePredicateSuite; delete ledger.completePredicateSuite; ledger.referencePredicateCount = 2 }
    const mst = { layerAwareMstStats: { completed: true, connectionsProcessed: 1000000000, inputPointOccurrences: 1000000000, inputDistinctLayerKeys: 1000000000, mstCoveredLayerKeys: 1000000000, missingLayerKeys: 0, coincidentCrossLayerGroups: 1000000000, zeroDistanceLayerEdges: 1000000000, mstSelectedEdges: 1000000000 } }
    const task: any = { datasetName: "synthetic", sampleNumber: 1, scenario: { mst: role === "N" ? undefined : mst, joint: role === "N" || mode === "UNREACHED" ? undefined : { stats: { originalOwnerCopperFeedback: ledger } } } }
    const solver = adapter.createExperimentAuditSolver(SyntheticFeedbackSolver, task, {})
    const terminal: any = adapter.getExperimentAuditEvidence(solver, task).evidence
    const rows: any[] = []
    const observer = createPhaseCheckpointObserver({ outputDirectory: directory, sourceSha256: sourceHash, evidencePaths: paths, metadata, append: (_path, text) => { maxRowBytes = Math.max(maxRowBytes, Buffer.byteLength(text)); rows.push(JSON.parse(text)); rowsWritten++ } })
    observer.constructorEnter(); observer.install(solver); observer.solveEnter(performance.now()); solver._step(); observer.solveExit()
    assert.deepEqual(observer.getStatus().errors, []); assert.equal(observer.getStatus().truncated, false)
    assert.deepEqual(terminal[paths[0]!], role === "N" ? null : mst.layerAwareMstStats)
    assert.deepEqual(terminal[paths[1]!], role === "N" || mode === "UNREACHED" ? null : ledger)
    for (const row of rows.slice(1)) {
      assert.equal(row.evidenceOmittedForRowLimit, undefined)
      assert.deepEqual(row.evidence, terminal)
      if (role !== "N" && mode !== "UNREACHED") assert.equal(Object.keys(row.evidence[paths[1]!]).length, 15)
    }
  }
  assert.equal(getterCalls, 0); assert(maxRowBytes <= 4096)
  console.log(JSON.stringify({ status: "PASS_EXPLICIT_ROLE_FROZEN_TWO_PATH_OBSERVER", role, modes: 3, rowsWritten, maxRowBytes, getterCalls, realBoards: 0, runtime: Bun.version }))
} finally {
  if (previousConfig === undefined) delete process.env.EXPERIMENT_AUDIT_CONFIG
  else process.env.EXPERIMENT_AUDIT_CONFIG = previousConfig
  if (previousOutput === undefined) delete process.env.EXPERIMENT_AUDIT_OUTPUT
  else process.env.EXPERIMENT_AUDIT_OUTPUT = previousOutput
  rmSync(directory, { recursive: true, force: true })
}
