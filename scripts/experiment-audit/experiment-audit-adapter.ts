import { createHash } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import type { BenchmarkTask } from "./benchmark-types"

type AuditConfig = {
  solverName: string
  solverModule: string
  options: Record<string, unknown>
  evidencePaths: string[]
}
const config: AuditConfig = JSON.parse(readFileSync(process.env.EXPERIMENT_AUDIT_CONFIG!, "utf8"))
const auditModule = await import(resolve(process.cwd(), config.solverModule))
const configuredConstructor = auditModule[config.solverName]
if (typeof configuredConstructor !== "function") {
  throw new Error(`Configured experiment constructor ${config.solverName} is absent`)
}
const sourceInputs = new WeakMap<object, { original: BenchmarkTask["scenario"]; inputHash: string; constructorTimeMs: number }>()
const progressWrittenAt = new WeakMap<object, number>()
const hash = (value: unknown): string => createHash("sha256").update(JSON.stringify(value)).digest("hex")

export function getExperimentAuditConstructor(): any {
  return configuredConstructor
}

export function createExperimentAuditSolver(ctor: any, task: BenchmarkTask, scenarioOptions: unknown): any {
  const original = structuredClone(task.scenario)
  const inputHash = hash(original)
  const start = performance.now()
  const solver = new ctor(task.scenario, { ...(scenarioOptions as object ?? {}), ...config.options })
  sourceInputs.set(solver, { original, inputHash, constructorTimeMs: performance.now() - start })
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
  const summary = {
    ...getExperimentAuditEvidence(solver, task),
    rawOutputHash: hash(rawOutput),
    rawNewTracesHash: hash(traces),
    outputCaptureTimeMs: performance.now() - start,
  }
  writeFileSync(resolve(outputDirectory, "capture-provenance.json"), JSON.stringify(summary))
  return summary
}
