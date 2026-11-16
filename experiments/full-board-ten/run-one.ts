import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { gzipSync, gunzipSync } from "node:zlib"
import { createHash } from "node:crypto"

const [caseFile, outputArg, executionMode = "full"] = process.argv.slice(2)
if (!caseFile || !outputArg) throw new Error("Usage: run-one.ts CASE.json OUTPUT")
if (!["full", "geometry"].includes(executionMode)) throw new Error("Execution mode must be full or geometry")
const task = JSON.parse(readFileSync(caseFile, "utf8"))
const output = resolve(outputArg)
mkdirSync(output, { recursive: true })
const environment = { ...process.env }
delete environment.FULL_BOARD_CORE_MODULE
delete environment.FULL_BOARD_COPPER_MODULE
const started = performance.now()
const log = openSync(join(output, "worker.log"), "w")
const worker = Bun.spawn([process.execPath, join(import.meta.dir, "render-published.tsx"), resolve(caseFile), output, executionMode], { cwd: import.meta.dir, env: environment, stdout: log, stderr: log })
let peakRssKb = 0, hardTimedOut = false
const sample = setInterval((): void => {
  try {
    const match = /VmHWM:\s+(\d+)/.exec(readFileSync(`/proc/${worker.pid}/status`, "utf8"))
    if (match) peakRssKb = Math.max(peakRssKb, Number(match[1]))
  } catch (error: any) { if (error.code !== "ENOENT" && error.code !== "ESRCH") throw error }
}, 1000)
const watchdog = setTimeout((): void => { hardTimedOut = true; worker.kill("SIGKILL") }, 960000)
const renderExitCode = await worker.exited
clearInterval(sample)
clearTimeout(watchdog)
closeSync(log)
const diagnosticPath = join(output, "coarse-diagnostics.json")
if (existsSync(diagnosticPath)) {
  const diagnostic = JSON.parse(readFileSync(diagnosticPath, "utf8"))
  for (const report of diagnostic.reports) console.log(`COARSE_ROUTING_DIAGNOSTIC_SUMMARY ${JSON.stringify({ id: task.id, cohort: task.cohort,
    phase: report.phase, inputNetCount: report.inputNetCount, innerHookInstalled: report.innerHookInstalled ?? Boolean(report.configured),
    configured: report.configured, lifecycleCounts: report.lifecycleCounts,
    firstExhaustedSearch: report.firstExhaustedSearch ?? null, firstRejectedGoalApproach: report.firstRejectedGoalApproach ?? null,
    firstNonfiniteGoalApproachWithoutPriorGoal: report.firstNonfiniteGoalApproachWithoutPriorGoal ?? null,
    final: report.final ? { iterations: report.final.iterations, MAX_ITERATIONS: report.final.MAX_ITERATIONS, currentRoute: report.final.currentRoute,
      pendingRouteCount: report.final.pendingRouteCount, neverAttemptedCount: report.final.neverAttemptedCount,
      iterationsSincePreviousRouteEvent: report.final.iterationsSincePreviousRouteEvent,
      neverSuccessfullyRoutedCount: report.final.neverSuccessfullyRouted.length, candidateQueueLength: report.final.candidateQueueLength,
      bestCompleteSnapshotPresent: report.final.bestCompleteSnapshotPresent, selectiveRerip: report.final.selectiveRerip } : null,
  })}`)
  if (task.id === "glider" && task.cohort === "spaced") {
    const selected = diagnostic.reports.filter((report: any) => report.phase === "other_signals")
    const report = selected.length === 1 ? selected[0] : null
    const packet = JSON.stringify({ id: task.id, cohort: task.cohort, phase: "other_signals", reportCount: selected.length, pendingTerminalCut: report?.pendingTerminalCut ?? null })
    console.log(`GLIDER_PENDING_TERMINAL_CUT ${Buffer.byteLength(packet) < 24 * 1024 ? packet : JSON.stringify({ id: task.id, cohort: task.cohort, observerError: "Selected packet exceeded 24KiB; full artifact retained" })}`)
    const routeId = report?.final?.currentRoute?.routeId
    const census = JSON.stringify({ id: task.id, cohort: task.cohort, phase: "other_signals", reportCount: selected.length,
      currentRouteCounters: typeof routeId === "number" ? { routeId, attempts: report.final.routeAttempts?.[routeId] ?? null, successes: report.final.routeSuccesses?.[routeId] ?? null } : null,
      currentSearchCensus: report?.currentSearchCensus ?? null })
    console.log(`GLIDER_CURRENT_SEARCH_CENSUS ${Buffer.byteLength(census) < 24 * 1024 ? census : JSON.stringify({ id: task.id, cohort: task.cohort, observerError: "Census packet exceeded 24KiB; full artifact retained" })}`)
  }
}
if (task.liveReachabilityCandidate) {
  const proof = task.liveReachabilityCandidate
  const digest = (path: string): string => createHash("sha256").update(readFileSync(path)).digest("hex")
  if (digest(proof.originalEntry) !== proof.inputSha256 || digest(proof.candidateEntry) !== proof.outputSha256 || digest(proof.originalCoreEntry) !== proof.originalCoreSha256 || digest(proof.helperProofPath) !== proof.helperProofSha256 || digest(proof.helperEntry) !== proof.helperEntrySha256) throw new Error("Routing candidate or original package provenance changed during render")
}
const processResult = { id: task.id, cohort: task.cohort, experiment: task.experiment ?? "published", dependencyOverrides: task.dependencyOverrides ?? [], liveReachabilityCandidate: task.liveReachabilityCandidate ?? null, routingSourceOverride: Boolean(task.routingSourceOverride), mode: "phased", executionMode, renderExitCode, hardTimedOut, renderWallMs: performance.now() - started, peakRssMiB: peakRssKb / 1024, captureDeadlineMs: 900000, hardDeadlineMs: 960000, memoryCap: null }
writeFileSync(join(output, "process.json"), JSON.stringify(processResult, null, 2))

let auditExitCode: number | null = null, auditTimedOut = false
let emittedCounts: Record<string, number> | null = null
const compressedCircuit = join(output, "circuit.json.gz")
if (existsSync(compressedCircuit)) {
  const rawCircuit = join(output, "circuit.json")
  if (existsSync(rawCircuit)) throw new Error("Refusing to overwrite a preexisting raw circuit artifact")
  writeFileSync(rawCircuit, gunzipSync(readFileSync(compressedCircuit)))
  const rawJson = JSON.parse(readFileSync(rawCircuit, "utf8"))
  emittedCounts = Object.fromEntries(["source_component", "source_net", "pcb_smtpad", "pcb_plated_hole", "pcb_hole", "pcb_trace", "pcb_via", "pcb_copper_pour"].map(type => [type, rawJson.filter((element: any) => element.type === type).length]))
  const auditEnvironment = { ...environment }
  for (const file of task.assessmentSourceFiles) {
    if (createHash("sha256").update(readFileSync(file.path)).digest("hex") !== file.sha256) throw new Error(`Authentic assessment source changed: ${file.path}`)
  }
  const runtimeRoot = task.runtimeRoot ?? import.meta.dir
  let args: string[]
  if (task.cohort === "original") {
    if (!task.assessmentCopperModule) throw new Error("Original pours require the exact published-Core assessment-only copper module")
    auditEnvironment.FULL_BOARD_COPPER_MODULE = resolve(task.assessmentCopperModule)
    args = [process.execPath, task.assessorModule, task.id, output]
  } else {
    args = [process.execPath, task.assessorModule, runtimeRoot, task.id, output, "full-board"]
  }
  const auditLog = openSync(join(output, "audit.log"), "w")
  const audit = Bun.spawn(args, { cwd: task.assessmentRoot, env: auditEnvironment, stdout: auditLog, stderr: auditLog })
  const auditTimer = setTimeout((): void => { auditTimedOut = true; audit.kill("SIGKILL") }, 180000)
  auditExitCode = await audit.exited
  clearTimeout(auditTimer)
  closeSync(auditLog)
  if (auditExitCode !== 0) console.error(`FULL_BOARD_ASSESSMENT_ERROR ${task.id} ${task.cohort}\n${readFileSync(join(output, "audit.log"), "utf8")}`)
  // The raw file was created above solely for the unchanged original assessors.
  unlinkSync(rawCircuit)
  const findings = join(output, "findings.json")
  if (existsSync(findings)) { writeFileSync(`${findings}.gz`, gzipSync(readFileSync(findings), { level: 1 })); unlinkSync(findings) }
}
const progressPath = join(output, "progress.json")
const assessmentPath = join(output, "assessment.json")
const progress = existsSync(progressPath) ? JSON.parse(readFileSync(progressPath, "utf8")) : null
const assessment = existsSync(assessmentPath) ? JSON.parse(readFileSync(assessmentPath, "utf8")) : null
const assessmentReady = auditExitCode === 0 && !auditTimedOut && assessment !== null
let connectedNets: number | null = null
if (assessmentReady) {
  console.log(`FULL_BOARD_ASSESSMENT ${JSON.stringify({ id: task.id, cohort: task.cohort, assessment })}`)
  if (typeof assessment.connectedNets !== "number") throw new Error("Assessor omitted physical net completion count")
  connectedNets = assessment.connectedNets
  if (task.cohort === "original" && assessment.routableNets !== task.expectedRoutableNets) throw new Error("Original requested-net denominator changed")
  if (task.cohort === "spaced" && assessment.requestedNets !== task.expectedRoutableNets) throw new Error("Spaced requested-net denominator changed")
}
const geometryErrorCount = assessmentReady ? assessment.geometryErrors.length : null
const membershipErrorCount = assessmentReady && task.cohort === "original" ? assessment.membershipErrors.length : null
const listedFindingCount = assessmentReady ? Object.values(assessment.findings as Record<string, number>).reduce((sum, value) => sum + value, 0) : null
const commonGroups = [
  ["overlap", "trace_overlap"], ["padTrace", "pad_trace"], ["viaTrace", "via_trace"], ["viaPad", "via_pad"],
  ["viaSpacing", "via_spacing"], ["contiguous", "contiguous"], ["viaInPad", "via_in_pad"], ["holeTrace", "hole_trace"],
]
const sharedDrcByGroup = assessmentReady ? Object.fromEntries(commonGroups.map(([original, spaced]) => {
  const count = assessment.findings[task.cohort === "original" ? original : spaced]
  if (typeof count !== "number") throw new Error(`Assessor omitted common DRC group ${original}`)
  return [original, count]
})) : null
const sharedDrcErrorCount = sharedDrcByGroup ? Object.values(sharedDrcByGroup).reduce((sum, count) => sum + count, 0) : null
const completeSourceCounts = emittedCounts !== null && emittedCounts.source_component === task.expectedComponents && emittedCounts.source_net === task.expectedNets && emittedCounts.pcb_smtpad + emittedCounts.pcb_plated_hole + emittedCounts.pcb_hole === task.expectedPads
const phasesCompleted = progress !== null && progress.phases.every((phase: any) => phase.status === "completed")
const renderSettled = renderExitCode === 0 && !hardTimedOut && progress?.renderCompleted === true && progress.status === "render_settled" && phasesCompleted
const routingPolicyObserved = progress?.wasmUsage?.routingOrUnknownAttempts === 0 && Array.isArray(progress?.forbiddenRoutingSolverSelections) && progress.forbiddenRoutingSolverSelections.length === 0
const completeAndClean = renderSettled && routingPolicyObserved && assessmentReady && completeSourceCounts && connectedNets === task.expectedRoutableNets && geometryErrorCount === 0 && (membershipErrorCount === null || membershipErrorCount === 0) && listedFindingCount === 0
const geometryOnlyValidated = executionMode === "geometry" && renderExitCode === 0 && progress?.renderCompleted === true && progress.status === "geometry_only" && routingPolicyObserved && progress.phases.length === 0 && assessmentReady && completeSourceCounts && emittedCounts!.pcb_trace === 0 && emittedCounts!.pcb_via === 0 && geometryErrorCount === 0 && (membershipErrorCount === null || membershipErrorCount === 0)
const result = {
  ...processResult, auditExitCode, auditTimedOut, assessmentReady, renderSettled, phasesCompleted,
  emittedCounts, completeSourceCounts,
  routingPolicyObserved, wasmUsage: progress?.wasmUsage ?? null,
  requestedRoutableNets: task.expectedRoutableNets, connectedNets, geometryErrorCount, membershipErrorCount,
  assessmentProfile: task.cohort === "original" ? "original_nine_groups" : "spaced_eleven_groups",
  listedFindingCount, sharedDrcByGroup, sharedDrcErrorCount,
  status: geometryOnlyValidated ? "geometry_only_validated" : completeAndClean ? "complete_and_clean" : assessmentReady ? "incomplete_or_errors" : "assessment_unavailable",
  completeAndClean, geometryOnlyValidated,
  lastPhase: progress?.phases?.at(-1)?.name ?? null,
  currentPhase: progress?.phases?.findLast((phase: any) => phase.status === "running")?.name ?? null,
  lastError: progress?.errors?.at(-1) ?? null,
  limitations: "Recovered assessors use actual trace/via continuity and, for original pours, published-Core physical polygon groups. Centerline-only contacts outside pour groups may be conservatively undercounted; source-net declarations alone never complete a net. Geometry checks differ by authentic cohort; original checker does not independently compare every pad width/rotation/shape.",
}
writeFileSync(join(output, "result.json"), JSON.stringify(result, null, 2))
console.log(`FULL_BOARD_CASE_RESULT ${JSON.stringify(result)}`)
