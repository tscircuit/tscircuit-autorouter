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
const busObserverPath = join(output, "bus-negotiation-observer.json")
if (existsSync(busObserverPath)) {
  const report = JSON.parse(readFileSync(busObserverPath, "utf8"))
  const { searchSummary, ...summary } = report.summary
  const totals = new Map<string, { nativeNet: string; stage: string; searches: number; solved: number; interruptedBeforeCancel: number; failedByReason: Record<string, number> }>()
  for (const row of searchSummary) {
    const key = `${row.nativeNet}|${row.stage}`
    const total = totals.get(key) ?? { nativeNet: row.nativeNet, stage: row.stage, searches: 0, solved: 0, interruptedBeforeCancel: 0, failedByReason: {} }
    total.searches += row.searches
    total.solved += row.solved
    total.interruptedBeforeCancel += row.interruptedBeforeCancel
    for (const [reason, count] of Object.entries(row.failedByReason)) total.failedByReason[reason] = (total.failedByReason[reason] ?? 0) + Number(count)
    totals.set(key, total)
  }
  const packets: { kind: string; data: unknown }[] = [
    { kind: "summary", data: summary },
    { kind: "per-net-search-totals", data: [...totals.values()] },
  ]
  for (const kind of ["fatalWitnesses", "searchRepresentatives", "firstBlocks", "viaHoleRejections", "escapeHoleConflicts", "compatibilityConflicts", "expandedEmpty", "variantExceptions"]) {
    const rows = report.witnesses[kind]
    const seen = new Set<string>()
    const selected = []
    const limit = kind === "fatalWitnesses" ? 8 : 4
    for (const row of rows) {
      const key = JSON.stringify([row.event, row.reason, row.connection?.name, row.kind, row.stage, row.outcome, row.invocation?.allowPadEdgeSites, row.targetLayer, row.end, row.alignSurfaceGrid, row.allowPadEdgeSites, row.connection?.pointsToConnect?.values?.map(point => point.layer), row.firstNames])
      if (seen.has(key)) continue
      seen.add(key)
      if (selected.length < limit) selected.push(row)
    }
    packets.push({ kind: `${kind}-coverage`, data: { available: rows.length, distinct: seen.size, selected: selected.length, selectionLimit: limit } })
    for (const [index, data] of selected.entries()) packets.push({ kind: `${kind}-${index}`, data })
  }
  for (const { kind, data } of packets) {
    const packet = JSON.stringify({ kind, data })
    const bytes = Buffer.byteLength(packet)
    if (bytes <= 24576) console.log(`BUS_NEGOTIATION_OBSERVATION ${packet}`)
    else console.log(`BUS_NEGOTIATION_OBSERVATION ${JSON.stringify({ kind, notForwarded: true, bytes, reason: "Selected witness exceeds the ordinary diagnostic log limit", artifact: "bus-negotiation-observer.json" })}`)
  }
}
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
}
const processResult = { id: task.id, cohort: task.cohort, experiment: task.experiment ?? "published", dependencyOverrides: task.dependencyOverrides ?? [], mode: "phased", executionMode, renderExitCode, hardTimedOut, renderWallMs: performance.now() - started, peakRssMiB: peakRssKb / 1024, captureDeadlineMs: 900000, hardDeadlineMs: 960000, memoryCap: null }
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
  if (existsSync(findings) && task.experiment === "bus-observer") {
    const viaPadErrors = JSON.parse(readFileSync(findings, "utf8")).viaPad
    const selectedErrors = viaPadErrors.slice(0, 4)
    const ids = new Set<string>(selectedErrors.flatMap(error => error.pcb_pad_ids))
    const selected = rawJson.filter(element => ids.has(element.pcb_via_id ?? element.pcb_smtpad_id ?? element.pcb_plated_hole_id))
    const related = [...selected]
    for (const element of selected) {
      const port = rawJson.find(row => row.type === "pcb_port" && row.pcb_port_id === element.pcb_port_id)
      const component = rawJson.find(row => row.type === "pcb_component" && row.pcb_component_id === element.pcb_component_id)
      const trace = rawJson.find(row => row.type === "pcb_trace" && row.pcb_trace_id === element.pcb_trace_id)
      if (port) related.push(port)
      if (component) related.push(component)
      if (trace) related.push({ type: trace.type, pcb_trace_id: trace.pcb_trace_id, source_trace_id: trace.source_trace_id, subcircuit_connectivity_map_key: trace.subcircuit_connectivity_map_key })
      for (const source of [
        rawJson.find(row => row.type === "source_port" && row.source_port_id === port?.source_port_id),
        rawJson.find(row => row.type === "source_component" && row.source_component_id === component?.source_component_id),
      ]) if (source) related.push(source)
    }
    const witness = { canonicalAssessmentReused: true, viaPadErrorCount: viaPadErrors.length, truncatedErrors: viaPadErrors.length > selectedErrors.length, errors: selectedErrors, referencedElements: related }
    const packet = JSON.stringify(witness)
    writeFileSync(join(output, "via-pad-witness.json"), packet)
    if (Buffer.byteLength(packet) <= 24576) console.log(`BUS_PRIOR_COPPER_FINDING ${packet}`)
    else console.log(`BUS_PRIOR_COPPER_FINDING ${JSON.stringify({ notForwarded: true, bytes: Buffer.byteLength(packet), artifact: "via-pad-witness.json" })}`)
  }
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
