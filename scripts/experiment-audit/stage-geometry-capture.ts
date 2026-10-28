import { createHash } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"

type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
type CaptureOptions = { outputDirectory: string; metadata: Record<string, unknown>; sourceSha256: string; original: unknown }
type CaptureRecord = { sequence: number; boundary: string; phase: string; file: string; bytes: number; sha256: string }

const PHASES = new Set([
  "highDensityRouteSolver", "highDensityForceImproveSolver", "highDensityRepairSolver",
  "highDensityStitchSolver", "traceSimplificationSolver", "mutatedPreloadedTraceSimplificationSolver",
  "traceWidthSolver", "globalDrcForceImproveSolver", "pipeline9JointDrcRepairSolver",
  "effortCleanupSolver", "powerTraceExpansionSolver", "lengthMatchingPostProcessingSolver",
])
const FIELDS = [
  "lastConnectivitySafeTraces", "bestRoutes", "stats", "outputTraces", "expandedTraces", "inputSrj", "routes", "hdRoutes", "originalHdRoutes", "improvedRoutesByIndex", "repairedRoutesByIndex",
  "mergedHdRoutes", "simplifiedHdRoutes", "hdRoutesWithWidths", "inputHdRoutes", "outputHdRoutes",
  "combinedOutput", "inputNewHdRoutes", "inputUpdatedPreloadedTraces", "syntheticConnectionNames",
  "params", "exactRepairParams", "guardedInputHdRoutes", "nodePfById", "fixedHdRoutes",
]

function own(value: any, key: string): any {
  if (!value || (typeof value !== "object" && typeof value !== "function")) return undefined
  return Object.getOwnPropertyDescriptor(value, key)?.value
}

// Never invokes getters, toJSON methods, solver output methods, or normalizers.
// Maps and Sets retain typed entries; methods are represented without calling them.
function cloneOwnData(value: unknown, ancestors: Set<object>, budget: { nodes: number }, depth = 0): Json {
  if (++budget.nodes > 2000000 || depth > 64) throw new Error("Stage data exceeds structural capture bounds")
  if (value === null || typeof value === "string" || typeof value === "boolean") return value
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return { $number: String(value) }
    return value
  }
  if (value === undefined) return { $undefined: true }
  if (typeof value === "function") return { $function: true }
  if (typeof value !== "object") throw new Error("Unsupported stage data primitive")
  if (ancestors.has(value)) throw new Error("Cyclic stage capture data")
  ancestors.add(value)
  try {
    if (value instanceof Map) return { $map: Array.from(Map.prototype.entries.call(value), ([key, item]) => [cloneOwnData(key, ancestors, budget, depth + 1), cloneOwnData(item, ancestors, budget, depth + 1)]) }
    if (value instanceof Set) return { $set: Array.from(Set.prototype.values.call(value), (item) => cloneOwnData(item, ancestors, budget, depth + 1)) }
    const descriptors = Object.getOwnPropertyDescriptors(value)
    if (Array.isArray(value)) {
      const length = descriptors.length?.value
      if (!Number.isSafeInteger(length) || length < 0) throw new Error("Invalid stage array length")
      return Array.from({ length }, (_, index) => {
        const descriptor = descriptors[String(index)]
        if (!descriptor || !("value" in descriptor)) throw new Error("Sparse or accessor stage array")
        return cloneOwnData(descriptor.value, ancestors, budget, depth + 1)
      })
    }
    const result: { [key: string]: Json } = Object.create(null)
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!descriptor.enumerable) continue
      if (!("value" in descriptor)) throw new Error("Accessor in stage data: " + key)
      result[key] = cloneOwnData(descriptor.value, ancestors, budget, depth + 1)
    }
    return result
  } finally { ancestors.delete(value) }
}

function stageFields(stage: any): Record<string, unknown> {
  const result: Record<string, unknown> = { solved: own(stage, "solved"), failed: own(stage, "failed"), iterations: own(stage, "iterations"), MAX_ITERATIONS: own(stage, "MAX_ITERATIONS") }
  for (const key of FIELDS) {
    const descriptor = stage && Object.getOwnPropertyDescriptor(stage, key)
    if (descriptor && "value" in descriptor) result[key] = descriptor.value
  }
  for (const key of ["exactRepairSolver", "clearanceProjectionSolver", "activeSubSolver", "powerTraceExpanderSolver"]) {
    const nested = own(stage, key)
    if (!nested || nested === stage) continue
    const fields: Record<string, unknown> = {}
    for (const field of FIELDS) {
      const descriptor = Object.getOwnPropertyDescriptor(nested, field)
      if (descriptor && "value" in descriptor) fields[field] = descriptor.value
    }
    if (Object.keys(fields).length) result[key] = fields
  }
  return result
}

export function createStageGeometryCapture(options: CaptureOptions) {
  const directory = resolve(options.outputDirectory, "stage-geometry")
  const metadata = { ...options.metadata }
  const records: CaptureRecord[] = []
  const errors: string[] = []
  const seen = new Set<string>()
  let totalBytes = 0
  const status = (): Record<string, unknown> => ({ schemaVersion: 1, sourceSha256: options.sourceSha256, ...metadata, diagnosticOnly: true, timingQualified: false, records: [...records], totalBytes, errors: [...errors] })
  const save = (): void => { writeFileSync(resolve(directory, "manifest.json"), JSON.stringify(status())) }
  const capture = (boundary: string, phase: string, value: unknown): void => {
    const identity = boundary + ":" + phase
    if (seen.has(identity)) return
    seen.add(identity)
    try {
      if (records.length >= 32) throw new Error("Stage capture record limit exceeded")
      const plain = cloneOwnData(value, new Set(), { nodes: 0 })
      const text = JSON.stringify({ schemaVersion: 1, metadata, sourceSha256: options.sourceSha256, diagnosticOnly: true, timingQualified: false, boundary, phase, value: plain })
      const bytes = Buffer.byteLength(text)
      if (bytes > 64 * 1024 * 1024 || totalBytes + bytes > 256 * 1024 * 1024) throw new Error("Stage capture byte limit exceeded")
      const file = String(records.length).padStart(2, "0") + "-" + phase + "-" + boundary + ".json"
      writeFileSync(resolve(directory, file), text)
      totalBytes += bytes
      records.push({ sequence: records.length, boundary, phase, file, bytes, sha256: createHash("sha256").update(text).digest("hex") })
      save()
    } catch (error) {
      if (errors.length < 16) errors.push(identity + ": " + String(error).slice(0, 384))
      try { save() } catch { /* Capture I/O never changes original routing exceptions. */ }
    }
  }
  try { mkdirSync(directory, { recursive: true }); capture("original_input", "pipeline", options.original) }
  catch (error) { errors.push("Capture setup: " + String(error).slice(0, 384)) }
  return {
    captureBoundary(kind: string, phaseName: string, solver: any, value?: unknown): void {
      if (!PHASES.has(phaseName)) return
      if (kind === "constructor_params_return") {
        capture(kind, phaseName, value)
        if (phaseName === "highDensityRouteSolver") capture("pipeline_context", phaseName, {
          highDensityNodePortPoints: own(solver, "highDensityNodePortPoints"),
          srjWithPointPairs: own(solver, "srjWithPointPairs"), connMap: own(solver, "connMap"),
        })
      } else if (kind === "completed_phase") capture(kind, phaseName, stageFields(value))
    },
    captureFinal(traces: unknown, output: unknown): void { capture("final_output", "pipeline", { traces, output }) },
    getStatus: status,
  }
}
