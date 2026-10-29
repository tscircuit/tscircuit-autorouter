import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createPhaseCheckpointObserver } from "../phase-checkpoint-observer"

// One synthetic serializer/control test. No solver, board, checker, or build.
const paths = ["witnessViaPadRepairSolver.stats", "witnessViaPadRepairSolver.qualification", "witnessViaPadRepairSolver.stats.reasons.0", "witnessViaPadRepairSolver.stats.lastRejectionReasons.0"]
const directory = mkdtempSync(join(tmpdir(), "quality6-observer-"))
let maxRowBytes = 0
try {
  for (const mode of ["NO_PROPOSAL", "ACCEPTED", "SEARCH_EXHAUSTED"]) {
    const qualification = { status: mode, initialForeignViaPadFindings: 1, lastForeignViaPadFindings: 0, bestForeignViaPadFindings: 0, proposals: 16, accepted: mode === "ACCEPTED" ? 1 : 0, rejectionClass: "SRJ_ENVELOPE", protectedUnchanged: true, lastReferenceErrors: 0, lastSrjObstacleViolations: 1, lastViaPadPolicyViolations: 0, lastViaInPadViolations: 0, lastProofReasonCount: 1, lastX: -1234.123456789, lastY: -1234.123456789, initialCertificateStatus: "FAIL" }
    const stats = { activated: true, status: mode, proposalCount: 16, acceptedCandidateCount: mode === "ACCEPTED" ? 1 : 0, certificateChecks: 17, demandsChecked: 12345, candidateLedger: [], initialCertificateStatus: "FAIL", initialCopperFindingCount: 1, initialCopperFindingCounts: {}, initialReferenceErrorCount: 0, initialSrjObstacleViolationCount: 0, initialViaPadPolicyViolationCount: 0, initialViaInPadViolationCount: 0, initialOwnershipCoverage: "COMPLETE", certificateScope: "Published original-owner copper predicates; declared-terminal physical contact model; original reference, SRJ obstacle envelopes and via policy. Not universal manufacturing.", reasons: mode === "NO_PROPOSAL" ? ["a".repeat(384)] : [], lastRejectionReasons: mode === "SEARCH_EXHAUSTED" ? ["b".repeat(384)] : [] }
    const solver = { pipelineDef: [{ solverName: "witnessViaPadRepairSolver" }], currentPipelineStepIndex: 0, witnessViaPadRepairSolver: { stats, qualification }, activeSubSolver: null, iterations: 1000000000, MAX_ITERATIONS: 1000000000, solved: false, failed: false, error: null, _step() { if (mode === "SEARCH_EXHAUSTED") throw new Error("x".repeat(384)) } }
    const rows: any[] = []
    const observer = createPhaseCheckpointObserver({ outputDirectory: directory, sourceSha256: "d".repeat(64), evidencePaths: paths, metadata: { campaign: "witness-quality6-20261029:srj24:14:AB", algorithmSha: "a".repeat(40), inputSha256: "b".repeat(64), dataset: "srj24", originalSample: 14, arm: "B", executionOrder: "AB", githubRunId: "99999999999", controllerSha: "c".repeat(40), observedObjectPath: "solver", observedConstructorName: "AutoroutingPipelineSolver9_PreloadedTraceGraph", actualCacheProviderState: "disabled", observedRequestedOptions: { cacheProvider: null, effort: 1, experimentWitnessViaPadRepair: true } }, append: (_path, text) => { maxRowBytes = Math.max(maxRowBytes, Buffer.byteLength(text)); rows.push(JSON.parse(text)) } })
    observer.constructorEnter(); observer.install(solver); observer.solveEnter(performance.now())
    if (mode === "SEARCH_EXHAUSTED") assert.throws(() => solver._step(), /xxx/)
    else solver._step()
    observer.solveExit()
    assert.deepEqual(observer.getStatus().errors, []); assert.equal(observer.getStatus().truncated, false)
    for (const row of rows.slice(1)) {
      assert.equal(row.evidenceOmittedForRowLimit, undefined)
      assert.deepEqual(row.evidence[paths[1]!], qualification)
      assert.equal(Object.keys(row.evidence).length, 4)
      assert.equal(row.evidence[paths[2]!], mode === "NO_PROPOSAL" ? "a".repeat(384) : null)
      assert.equal(row.evidence[paths[3]!], mode === "SEARCH_EXHAUSTED" ? "b".repeat(384) : null)
    }
  }
  assert(maxRowBytes <= 4096)
  console.log(JSON.stringify({ status: "PASS_FROZEN_OBSERVER_FOUR_PATHS_FULL16_QUALIFICATION_OPTIONAL_REASONS_ERRORS_PRESERVED", runtime: Bun.version, modes: 3, maxRowBytes, realBoards: 0 }))
} finally { rmSync(directory, { recursive: true, force: true }) }
