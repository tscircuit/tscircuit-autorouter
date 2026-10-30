import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { isDeepStrictEqual } from "node:util"
import { requireValue, verifyRawMask, verifyCanonicalMask, type Move } from "./witness-local-repair-proposals"

const source = process.argv[2]!, output = process.argv[3]!, mode = process.argv[4]!
requireValue(mode === "retained" && process.env.GITHUB_ACTIONS === "true", "Actual production stage execution is Blacksmith-only")
const relative = "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/"
const certificateModule = await import(pathToFileURL(join(source, relative, "getPipeline9WitnessViaCertificate.source2109.ts")).href)
const stageModule = await import(pathToFileURL(join(source, relative, "Pipeline9RelativeWitnessRepairSolver.ts")).href)
const read = (name: string): any => JSON.parse(readFileSync(join(output, name), "utf8"))
const original = read("original-input.json"), pairs = read("point-pair-context.json"), traces = read("raw-new-traces.json"), originalCanonical = read("canonical-circuit-json.json")
const protectedTraces: any[] = []
const inputBytes = JSON.stringify([original, pairs, traces, protectedTraces, originalCanonical])
const hash = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex")
const summary = (value: any): any => ({ status: value.status, demandsChecked: value.demandsChecked, reasonCount: value.reasons.length,
  referenceErrorCount: value.referenceErrorCount, srjObstacleViolationCount: value.srjObstacleViolationCount,
  viaPadPolicyViolationCount: value.viaPadPolicyViolationCount, viaInPadViolationCount: value.viaInPadViolationCount,
  foreignViaPadFindings: value.copper.allFindings.filter((f: any) => f.checkClass === "viaPad" && f.classification === "DECLARED_FOREIGN_COPPER").length,
  ownershipCoverageStatus: value.copper.ownershipCoverageStatus })
const before = certificateModule.getPipeline9WitnessViaCertificate(original, pairs, traces)
const publishedNames = ["viaPad", "padTrace", "viaTrace", "traceOverlap", "differentNetViaSpacing", "sameNetViaSpacing", "padPad"].sort()
const completeChecks = (certificate: any): boolean => certificate.copper.allPublishedCopperChecksRun === true &&
  certificate.copper.ownershipCoverageStatus === "COMPLETE" && JSON.stringify(Object.keys(certificate.copper.checks).sort()) === JSON.stringify(publishedNames) &&
  JSON.stringify([...certificate.copper.checksRun].sort()) === JSON.stringify(publishedNames)
const geometryChecksZero = (certificate: any): boolean => completeChecks(certificate) && certificate.copper.qualifiedSupportedCopper === true &&
  Object.values(certificate.copper.checks).every((check: any) => check.count === 0) && certificate.referenceErrorCount === 0 &&
  certificate.srjObstacleViolationCount === 0 && certificate.viaPadPolicyViolationCount === 0 && certificate.viaInPadViolationCount === 0
requireValue(completeChecks(before), "Baseline full certificate omitted a published check or original-owner coverage")
requireValue(isDeepStrictEqual(JSON.parse(JSON.stringify(before.circuitJson)), originalCanonical), "Baseline canonical JSON geometry/material differs from the exact original retained artifact")
requireValue(JSON.stringify([original, pairs, traces, protectedTraces, originalCanonical]) === inputBytes, "Baseline certificate mutated protected retained inputs")
const stage = new stageModule.Pipeline9RelativeWitnessRepairSolver({ originalSrj: original, pointPairs: pairs, traces, protectedTraces })
let solveError: string | null = null, outputError: string | null = null, candidate: any = null
let solveCalls = 0
try { solveCalls++; stage.solve() } catch (error) { solveError = String(error) }
try { candidate = stage.getOutput() } catch (error) { outputError = String(error) }
const productionOutputReturned = Array.isArray(candidate)
if (!productionOutputReturned) candidate = traces
requireValue(JSON.stringify([original, pairs, traces, protectedTraces, originalCanonical]) === inputBytes, "Production stage mutated its retained inputs")
requireValue(stage.iterations <= 20 && stage.MAX_ITERATIONS === 20, "Production stage exceeded the predeclared twenty-step domain")
requireValue(Number.isInteger(stage.stats.proposalCount) && stage.stats.proposalCount >= 0 && stage.stats.proposalCount <= 16 && stage.qualification.proposals === stage.stats.proposalCount, "Production stage exceeded the sixteen-candidate portfolio domain")
const emittedMoves = stage.selectedMoves ?? []
const flatMoves: Move[] = emittedMoves.flatMap((move: any) => move.occurrences.map((occurrence: any) => ({
  kind: move.kind, occurrences: [{ traceIndex: occurrence.traceIndex, pointIndex: occurrence.pointIndex }],
  oldXY: occurrence.oldXY, newXY: occurrence.newXY, maximum: move.kind === "via" ? 0.25 : 0.02,
})))
requireValue(emittedMoves.every((move: any) => ["via", "wire"].includes(move.kind) && move.occurrences.length > 0), "Unsupported production movement record")
const differences = verifyRawMask(traces, candidate, flatMoves)
for (const move of flatMoves) {
  const occurrence = move.occurrences[0]!, point = traces[occurrence.traceIndex]?.route[occurrence.pointIndex]
  requireValue(point && occurrence.pointIndex > 0 && occurrence.pointIndex < traces[occurrence.traceIndex].route.length - 1, "Production stage moved a protected endpoint")
  requireValue(!Object.keys(point).some((name) => name.toLowerCase().includes("port")), "Production stage moved a port-bearing point")
  requireValue(Math.hypot(move.newXY.x - move.oldXY.x, move.newXY.y - move.oldXY.y) > 0 && Math.hypot(move.newXY.x - move.oldXY.x, move.newXY.y - move.oldXY.y) <= move.maximum, "Production stage exceeded its actual movement cap")
  requireValue(original.connections.every((connection: any) => connection.pointsToConnect.every((terminal: any) => terminal.x !== point.x || terminal.y !== point.y)), "Production stage moved an original terminal coordinate")
}
const candidateBytes = JSON.stringify(candidate)
const after = certificateModule.getPipeline9WitnessViaCertificate(original, pairs, candidate)
requireValue(JSON.stringify(candidate) === candidateBytes, "Final full certificate mutated the production output")
requireValue(JSON.stringify([original, pairs, traces, protectedTraces, originalCanonical]) === inputBytes, "Final certificate mutated protected retained inputs")
if (differences.length > 0) verifyCanonicalMask(before.circuitJson, after.circuitJson, traces, candidate, flatMoves)
else requireValue(JSON.stringify(before) === JSON.stringify(after), "Unchanged stage output produced a different complete certificate")
const stageBaselineMatches = stage.baselineCertificate !== undefined && JSON.stringify(stage.baselineCertificate) === JSON.stringify(before)
const stageFinalMatches = stage.finalCertificate !== undefined && JSON.stringify(stage.finalCertificate) === JSON.stringify(after)
const afterGeometryChecksZero = geometryChecksZero(after)
requireValue(completeChecks(after), "Final full certificate omitted a published check or original-owner coverage")
const geometryCount = (certificate: any): number => certificate.referenceErrorCount + certificate.srjObstacleViolationCount + certificate.viaPadPolicyViolationCount + certificate.viaInPadViolationCount + certificate.copper.allFindings.length
const applied = differences.length > 0
if (applied) requireValue(productionOutputReturned && solveError === null && outputError === null && stage.solved === true && stage.failed === false &&
  stageBaselineMatches && stageFinalMatches && stage.relativeProof?.status === "PASS" && stage.qualification?.localRepaired === true && afterGeometryChecksZero && geometryCount(after) < geometryCount(before),
  "Production stage returned changed copper without its complete local qualification")
requireValue(after.status !== "PASS", "This retained-stage trial cannot claim unexpected full-board recovery")
const result = { status: "RETAINED_PRODUCTION_STAGE_EXECUTION_ONLY", before: { summary: summary(before), fullCertificateSha256: hash(before), fullCertificate: before },
  after: { summary: summary(after), fullCertificateSha256: hash(after), fullCertificate: after },
  productionStage: { className: "Pipeline9RelativeWitnessRepairSolver", solveCalls, solved: stage.solved, failed: stage.failed, error: stage.error,
    solveError, outputError, productionOutputReturned, outputOrigin: productionOutputReturned ? "ACTUAL_PRODUCTION_STAGE_GET_OUTPUT" : "BASELINE_BECAUSE_PRODUCTION_STAGE_DID_NOT_RETURN",
    iterations: stage.iterations, maximumIterations: stage.MAX_ITERATIONS, attemptedCandidates: stage.stats.proposalCount, maximumCandidates: 16, qualification: stage.qualification, stats: stage.stats,
    selectedMoves: emittedMoves, relativeProof: stage.relativeProof, baselineCertificateMatchesIndependentBefore: stageBaselineMatches,
    finalCertificateMatchesIndependentAfter: stageFinalMatches },
  localRepair: { applied, geometryChecksZero: afterGeometryChecksZero, beforeGeometryFindingCount: geometryCount(before), afterGeometryFindingCount: geometryCount(after), rawMaskPassed: true, canonicalProtectedMaskPassed: true, differences,
    independentRelativeProofReplay: "PENDING_PYTHON_DATA_ONLY_REPLAY", accepted: false, fullBoardRecovery: false, qualityOrSpeedCredit: false },
  outputRawSha256: hash(candidate), inputBytesUnchanged: true, stageSolveCalls: solveCalls, routingExecutions: 0,
  accepted: false, fullBoardRecovery: false, qualityOrSpeedCredit: false,
  scope: "One actual production local-stage solve on exact retained data. Full original before/after source2109 certificate objects and all reason/check arrays remain visible. Relative local proof and improvement are separate from global UNKNOWN or full-board acceptance. No pipeline routing or speed claim." }
writeFileSync(join(output, "production-stage-output-traces.json"), JSON.stringify(candidate))
writeFileSync(join(output, "production-stage-trial.json"), JSON.stringify(result))
console.log(JSON.stringify({ status: result.status, before: result.before.summary, after: result.after.summary,
  stageSolveCalls: solveCalls, localRepairApplied: applied, productionStageStatus: stage.qualification?.status,
  accepted: false, fullBoardRecovery: false, qualityOrSpeedCredit: false }))
requireValue(solveError === null && outputError === null && productionOutputReturned && stage.solved === true && stage.failed === false,
  "Unexpected production stage error retained diagnostically; trial has no repair or acceptance credit")
