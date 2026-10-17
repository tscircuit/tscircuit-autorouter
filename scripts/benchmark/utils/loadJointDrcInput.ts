import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { Pipeline9JointDrcRepairSolverParams } from "../../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"

/** Restore object sharing recorded by the solver debugger's JSON exporter. */
export const loadJointDrcInput = (path: string): Pipeline9JointDrcRepairSolverParams => {
  const bytes = readFileSync(path)
  const parsed = JSON.parse((path.endsWith(".gz") ? gunzipSync(new Uint8Array(bytes)) : bytes).toString())
  const raw = Array.isArray(parsed) ? parsed[0] : parsed
  const values = new Map<string, Record<string, unknown>>()
  const index = (value: unknown, path: string): void => {
    if (!value || typeof value !== "object") return
    values.set(path, value as Record<string, unknown>)
    for (const [key, child] of Object.entries(value)) {
      index(child, Array.isArray(value) ? `${path}[${key}]` : /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
        ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`)
    }
  }
  index(raw, "$")
  for (const value of values.values()) {
    for (const [key, child] of Object.entries(value)) {
      if (child && typeof child === "object" && "$ref" in child) {
        const target = values.get(String(child.$ref))
        if (!target) throw new Error(`Unresolved input reference ${child.$ref}`)
        value[key] = target
      }
    }
  }
  return { ...raw, connMap: new ConnectivityMap(raw.connMap.netMap), mutatedPreloadedTraceIds: new Set(raw.mutatedPreloadedTraceIds) }
}
