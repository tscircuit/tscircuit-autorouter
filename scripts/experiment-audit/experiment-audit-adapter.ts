import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { createStageGeometryCapture } from "./stage-geometry-capture"
import { captureTerminalFailureGeometry } from "./capture-terminal-failure-geometry"
import { createPhaseCheckpointObserver } from "./phase-checkpoint-observer"
import type { BenchmarkTask } from "./benchmark-types"

type AuditConfig = {
  solverName: string
  solverModule: string
  options: Record<string, unknown>
  evidencePaths: string[]
  stageGeometryDiagnostic?: { sourceSha256: string }
  phaseCheckpointTarget?: "selected-pipeline9-child"
  phaseCheckpoint: { observerSourceSha256: string; campaign: string; algorithmSha: string; arm: string; githubRunId?: string; controllerSha?: string; executionOrder?: "AB" | "BA" }
}
const config: AuditConfig = JSON.parse(readFileSync(process.env.EXPERIMENT_AUDIT_CONFIG!, "utf8"))
if (config.stageGeometryDiagnostic && config.stageGeometryDiagnostic.sourceSha256 !== createHash("sha256").update(readFileSync(new URL("./stage-geometry-capture.ts", import.meta.url))).digest("hex")) throw new Error("Stage geometry diagnostic source hash mismatch")
const stageCaptures = new WeakMap<object, ReturnType<typeof createStageGeometryCapture>>()
const actualObserverHash = createHash("sha256").update(readFileSync(new URL("./phase-checkpoint-observer.ts", import.meta.url))).digest("hex")
if (config.phaseCheckpoint?.observerSourceSha256 !== actualObserverHash) throw new Error("Phase observer source hash mismatch")
const auditModule = await import(resolve(process.cwd(), config.solverModule))
const configuredConstructor = auditModule[config.solverName]
if (typeof configuredConstructor !== "function") {
  throw new Error(`Configured experiment constructor ${config.solverName} is absent`)
}
const sourceInputs = new WeakMap<object, { original: BenchmarkTask["scenario"]; inputHash: string; constructorTimeMs: number }>()
const phaseObservers = new WeakMap<object, ReturnType<typeof createPhaseCheckpointObserver>>()
const phaseTargetMetadata = new WeakMap<object, { objectPath: string; constructorName: string | null }>()
const terminalFailureCaptures = new WeakMap<object, ReturnType<typeof captureTerminalFailureGeometry>>()
const progressWrittenAt = new WeakMap<object, number>()
const hash = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex")

export function getExperimentAuditConstructor(): any {
  return configuredConstructor
}

function selectPhaseCheckpointTarget(solver: any): { target: any; objectPath: string } {
  if (config.phaseCheckpointTarget === undefined) return { target: solver, objectPath: "solver" }
  if (config.phaseCheckpointTarget !== "selected-pipeline9-child") throw new Error("Unsupported phase checkpoint target policy")
  const selection = Object.getOwnPropertyDescriptor(solver, "selection")?.value
  const eligible = selection && Object.getOwnPropertyDescriptor(selection, "eligible")?.value
  const child = Object.getOwnPropertyDescriptor(solver, "pipeline9")?.value
  if (typeof eligible !== "boolean") throw new Error("Geometry selector lacks an own-data eligibility decision")
  if (eligible && child !== undefined) throw new Error("Eligible direct selection unexpectedly contains Pipeline9")
  if (!eligible && (!child || typeof child !== "object")) throw new Error("General geometry selection lacks its own-data Pipeline9 instance")
  return eligible ? { target: solver, objectPath: "solver" } : { target: child, objectPath: "solver.pipeline9" }
}

export function createExperimentAuditSolver(ctor: any, task: BenchmarkTask, scenarioOptions: unknown): any {
  const original = structuredClone(task.scenario)
  const inputHash = hash(original)
  const observerMetadata: Record<string, unknown> = { campaign: config.phaseCheckpoint.campaign, arm: config.phaseCheckpoint.arm,
    algorithmSha: config.phaseCheckpoint.algorithmSha, githubRunId: config.phaseCheckpoint.githubRunId ?? null,
    controllerSha: config.phaseCheckpoint.controllerSha ?? null, dataset: task.datasetName,
    originalSample: task.sampleNumber, inputSha256: inputHash, executionOrder: config.phaseCheckpoint.executionOrder }
  const stageCapture = config.stageGeometryDiagnostic ? createStageGeometryCapture({
    outputDirectory: process.env.EXPERIMENT_AUDIT_OUTPUT!, metadata: observerMetadata,
    sourceSha256: config.stageGeometryDiagnostic.sourceSha256, original,
  }) : undefined
  const observer = createPhaseCheckpointObserver({
    outputDirectory: process.env.EXPERIMENT_AUDIT_OUTPUT!,
    sourceSha256: config.phaseCheckpoint.observerSourceSha256,
    evidencePaths: config.evidencePaths,
    metadata: observerMetadata,
    diagnosticBoundary: stageCapture?.captureBoundary,
  })
  observer.constructorEnter()
  const start = performance.now()
  let solver: any
  try { solver = new ctor(task.scenario, { ...(scenarioOptions as object ?? {}), ...config.options }) }
  catch (error) { observer.constructorThrow(error); throw error }
  const constructorTimeMs = performance.now() - start
  const observed = selectPhaseCheckpointTarget(solver)
  const prototypeConstructor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(observed.target), "constructor")?.value
  const constructorName = typeof prototypeConstructor === "function" ? Object.getOwnPropertyDescriptor(prototypeConstructor, "name")?.value ?? null : null
  phaseTargetMetadata.set(solver, { objectPath: observed.objectPath, constructorName })
  Object.assign(observerMetadata, { observedObjectPath: observed.objectPath, observedConstructorName: constructorName })
  observer.install(observed.target)
  phaseObservers.set(solver, observer)
  if (stageCapture) stageCaptures.set(solver, stageCapture)
  sourceInputs.set(solver, { original, inputHash, constructorTimeMs })
  return solver
}

function readEvidence(solver: any): Record<string, unknown> {
  return Object.fromEntries(config.evidencePaths.map((path) => {
    const value = path.split(".").reduce((part: any, key) => part?.[key], solver)
    if (value === undefined) return [path, null]
    if (value === null || typeof value !== "object") return [path, value]
    return [path, Object.fromEntries(Object.entries(value).filter(([, item]) =>
      item === null || ["number", "string", "boolean"].includes(typeof item),
    ))]
  }))
}

export function getExperimentAuditEvidence(solver: any, task: BenchmarkTask): Record<string, unknown> {
  const input = sourceInputs.get(solver)
  if (!input) throw new Error("Experiment solver lacks construction provenance")
  // This function is first called after runTask has frozen official elapsedTimeMs.
  // Capture only terminal failed state; never invoke a solver output getter.
  if (!solver.solved && phaseObservers.get(solver)?.getStatus().solveFinished && !terminalFailureCaptures.has(solver)) {
    terminalFailureCaptures.set(solver, captureTerminalFailureGeometry(solver, input.original, process.env.EXPERIMENT_AUDIT_OUTPUT!, {
      campaign: config.phaseCheckpoint.campaign, arm: config.phaseCheckpoint.arm, algorithmSha: config.phaseCheckpoint.algorithmSha,
      dataset: task.datasetName, originalSample: task.sampleNumber, inputSha256: input.inputHash,
    }))
  }
  return {
    actualSolverName: config.solverName,
    actualConstructorName: solver.constructor.name,
    solverModule: config.solverModule,
    options: config.options,
    solverSolved: Boolean(solver.solved),
    solverFailed: Boolean(solver.failed),
    solverError: solver.error ?? null,
    actualCacheProviderState: solver.cacheProvider === null ? "disabled" : solver.cacheProvider === undefined ? "not exposed by this backend" : "present",
    inputHash: input.inputHash,
    inputMutated: hash(task.scenario) !== input.inputHash,
    constructorTimeMs: input.constructorTimeMs,
    phaseCheckpoint: phaseObservers.get(solver)?.getStatus() ?? null,
    stageGeometryDiagnostic: stageCaptures.get(solver)?.getStatus() ?? null,
    phaseCheckpointObservedTarget: phaseTargetMetadata.get(solver) ?? null,
    terminalFailureGeometry: terminalFailureCaptures.get(solver) ?? null,
    evidence: readEvidence(solver),
  }
}

export function captureExperimentAuditProgress(solver: any, elapsedTimeMs: number, phaseName: string | undefined): void {
  const previous = progressWrittenAt.get(solver) ?? -Infinity
  if (elapsedTimeMs - previous < 1000) return
  progressWrittenAt.set(solver, elapsedTimeMs)
  const outputDirectory = process.env.EXPERIMENT_AUDIT_OUTPUT!
  mkdirSync(outputDirectory, { recursive: true })
  writeFileSync(resolve(outputDirectory, "latest-progress-evidence.json"), JSON.stringify({
    elapsedTimeMs, phaseName, actualSolverName: config.solverName,
    inputHash: sourceInputs.get(solver)?.inputHash,
    evidence: readEvidence(solver),
    observation: "Last observation from an existing official progress callback; unavailable later counters are not evidence of inactivity",
  }))
}

export function captureExperimentAuditOutput(solver: any, task: BenchmarkTask, traces: any[], rawOutput: unknown): Record<string, unknown> {
  const input = sourceInputs.get(solver)
  if (!input) throw new Error("Experiment solver lacks original input")
  const start = performance.now()
  const original = input.original
  const outputDirectory = process.env.EXPERIMENT_AUDIT_OUTPUT!
  mkdirSync(outputDirectory, { recursive: true })
  writeFileSync(resolve(outputDirectory, "original-input.json"), JSON.stringify(original))
  writeFileSync(resolve(outputDirectory, "raw-solver-output.json"), JSON.stringify(rawOutput))
  writeFileSync(resolve(outputDirectory, "raw-new-traces.json"), JSON.stringify(traces))
  writeFileSync(resolve(outputDirectory, "point-pair-context.json"), JSON.stringify(solver.srjWithPointPairs ?? original))
  stageCaptures.get(solver)?.captureFinal(traces, rawOutput)
  const summary = {
    ...getExperimentAuditEvidence(solver, task),
    rawOutputHash: hash(rawOutput),
    rawNewTracesHash: hash(traces),
    outputCaptureTimeMs: performance.now() - start,
  }
  writeFileSync(resolve(outputDirectory, "capture-provenance.json"), JSON.stringify(summary))
  return summary
}

export function startExperimentPhaseCheckpoints(solver: any, start: number): void {
  phaseObservers.get(solver)?.solveEnter(start)
}

export function finishExperimentPhaseCheckpoints(solver: any): void {
  phaseObservers.get(solver)?.solveExit()
}
