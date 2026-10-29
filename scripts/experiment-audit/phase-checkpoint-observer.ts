import { appendFileSync, mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

type ObserverOptions = {
  outputDirectory: string
  metadata: Record<string, unknown>
  evidencePaths?: string[]
  sourceSha256: string
  // Injection is used only by small observer tests; routing uses these defaults.
  now?: () => number
  append?: (path: string, text: string) => void
}

const MAX_ROWS = 256
const MAX_ROW_BYTES = 4096
const MAX_STRING = 384
const scalar = (value: unknown): unknown => {
  if (typeof value === "string") return value.slice(0, MAX_STRING)
  if (value === null || typeof value === "boolean") return value
  if (typeof value === "number" && Number.isFinite(value)) return value
  return null
}

// Deliberately reads existing data only: no output, graphics, connectivity or
// validation getter may run before a phase has completed.
function ownValue(value: any, key: string): any {
  if (!value || (typeof value !== "object" && typeof value !== "function")) return undefined
  return Object.getOwnPropertyDescriptor(value, key)?.value
}

function ownPath(value: any, path: string): any {
  for (const key of path.split(".")) value = ownValue(value, key)
  return value
}

export function createPhaseCheckpointObserver(options: ObserverOptions) {
  const now = options.now ?? (() => performance.now())
  const append = options.append ?? appendFileSync
  const path = resolve(options.outputDirectory, "phase-checkpoints.jsonl")
  const statusPath = resolve(options.outputDirectory, "phase-checkpoint-status.json")
  const status = { schemaVersion: 1, observerSourceSha256: options.sourceSha256,
    rowsWritten: 0, truncated: false, errors: [] as string[], installed: false,
    solveEntered: false, solveFinished: false }
  let solver: any
  let officialStart: number | null = null
  let lastIndex: unknown = Symbol("unobserved")
  let lastActive: unknown = Symbol("unobserved")
  const saveStatus = () => {
    try { writeFileSync(statusPath, JSON.stringify(status)) }
    catch (error) { if (status.errors.length < 4) status.errors.push(String(error).slice(0, MAX_STRING)) }
  }
  try { mkdirSync(options.outputDirectory, { recursive: true }); saveStatus() }
  catch (error) { status.errors.push(String(error).slice(0, MAX_STRING)) }

  const evidence = () => {
    const result: Record<string, unknown> = {}
    for (const path of (options.evidencePaths ?? []).slice(0, 4)) {
      const value = ownPath(solver, path)
      if (value === null || typeof value !== "object") result[path] = scalar(value)
      else result[path] = Object.fromEntries(Object.keys(value).slice(0, 16)
        .map((key) => [key, scalar(ownValue(value, key))]))
    }
    return result
  }
  const emit = (event: string, extra: Record<string, unknown> = {}) => {
    // Observation must never alter a routing return value or original exception.
    try {
      if (status.truncated) return
      if (status.rowsWritten >= MAX_ROWS - 1) {
        status.truncated = true
        extra = { nextEvent: event, limit: MAX_ROWS }
        event = "observer_truncated"
      }
      const stamp = now()
      const index = ownValue(solver, "currentPipelineStepIndex")
      const active = ownValue(solver, "activeSubSolver")
      const phase = ownValue(solver, "pipelineDef")?.[index]
      const record: Record<string, unknown> = { schemaVersion: 1, sequence: status.rowsWritten,
        ...options.metadata, observerSourceSha256: options.sourceSha256, event, monotonicMs: stamp,
        officialStartOffsetMs: officialStart === null ? null : stamp - officialStart,
        phaseIndex: scalar(index), phaseName: scalar(ownValue(phase, "solverName")),
        activeSolverName: active?.constructor?.name ?? null,
        iterations: scalar(ownValue(solver, "iterations")),
        maxIterations: scalar(ownValue(solver, "MAX_ITERATIONS")),
        activeIterations: scalar(ownValue(active, "iterations")),
        activeMaxIterations: scalar(ownValue(active, "MAX_ITERATIONS")),
        solved: scalar(ownValue(solver, "solved")), failed: scalar(ownValue(solver, "failed")),
        error: scalar(ownValue(solver, "error")), ...extra, evidence: evidence() }
      let text = JSON.stringify(record)
      if (Buffer.byteLength(text) > MAX_ROW_BYTES - 1) {
        delete record.evidence
        record.evidenceOmittedForRowLimit = true
        text = JSON.stringify(record)
      }
      if (Buffer.byteLength(text) > MAX_ROW_BYTES - 1) throw new Error("Checkpoint metadata exceeds4096bytes")
      append(path, text + "\n")
      status.rowsWritten++
      if (status.truncated) saveStatus()
    } catch (error) {
      if (status.errors.length < 4) status.errors.push(String(error).slice(0, MAX_STRING))
      saveStatus()
    }
  }

  const observeTransition = () => {
    const index = ownValue(solver, "currentPipelineStepIndex")
    const active = ownValue(solver, "activeSubSolver")
    // The only per-step work when nothing changes is a bounded set of
    // own-data-property reads and identity comparisons. No clock, filesystem, evidence walk or timer is used.
    if (index === lastIndex && active === lastActive) return
    lastIndex = index
    lastActive = active
    if (active) emit("active_subsolver_constructed")
    else if (!ownValue(solver, "solved") && !ownValue(solver, "failed")) emit("phase_setup_enter")
    if (ownValue(solver, "failed")) emit("phase_failed")
  }

  return {
    constructorEnter() { emit("pipeline_constructor_enter") },
    constructorThrow(error: unknown) { emit("pipeline_constructor_throw", { thrown: scalar(String(error)) }); saveStatus() },
    install(instance: any) {
      solver = instance
      if (!Array.isArray(solver.pipelineDef) || typeof solver._step !== "function") {
        status.errors.push("Unsupported pipeline lifecycle shape"); saveStatus(); return
      }
      for (const phase of solver.pipelineDef) {
        for (const [key, before, after] of [
          ["getConstructorParams", "constructor_params_enter", "constructor_params_exit"],
          ["onSolved", "on_solved_enter", "on_solved_exit"],
        ]) {
          const original = phase[key]
          if (typeof original !== "function") continue
          phase[key] = function (this: any, ...args: any[]) {
            emit(before)
            try { return Reflect.apply(original, this, args) }
            catch (error) { emit("lifecycle_throw", { boundary: key, thrown: scalar(String(error)) }); throw error }
            finally { emit(after) }
          }
        }
      }
      const originalStep = solver._step
      solver._step = function (this: any, ...args: any[]) {
        observeTransition()
        const before = ownValue(solver, "activeSubSolver")
        if (before && before !== lastRunActive) { lastRunActive = before; emit("phase_run_enter") }
        try { return Reflect.apply(originalStep, this, args) }
        catch (error) { emit("step_throw", { thrown: scalar(String(error)) }); throw error }
        finally { observeTransition() }
      }
      let lastRunActive: any = null
      status.installed = true
      emit("pipeline_constructor_exit")
      saveStatus()
    },
    solveEnter(start: number) { officialStart = start; status.solveEntered = true; emit("solve_enter"); saveStatus() },
    solveExit() { status.solveFinished = true; emit("solve_exit"); saveStatus() },
    getStatus() { return { ...status, errors: [...status.errors] } },
  }
}
