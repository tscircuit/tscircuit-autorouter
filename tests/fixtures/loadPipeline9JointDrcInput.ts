import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { Pipeline9JointDrcRepairSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver"

type Params = ConstructorParameters<typeof Pipeline9JointDrcRepairSolver>[0]
type JsonRecord = Record<string, unknown>

/** Restores the references and class instances in the debugger's exported input. */
export const loadPipeline9JointDrcInput = (path: string): Params => {
  const bytes = readFileSync(path)
  const json = path.endsWith(".gz") ? gunzipSync(bytes) : bytes
  const params = JSON.parse(json.toString("utf8"))[0] as JsonRecord
  const resolvePath = (path: string): unknown => {
    const keys = path.slice(1).match(/[^.\[\]]+/g) ?? []
    let value: unknown = params
    for (const key of keys) value = (value as JsonRecord)[key]
    return value
  }
  const restoreReferences = (value: JsonRecord): void => {
    for (const key of Object.keys(value)) {
      const child = value[key]
      if (!child || typeof child !== "object") continue
      const reference = (child as JsonRecord).$ref
      if (typeof reference === "string") value[key] = resolvePath(reference)
      else restoreReferences(child as JsonRecord)
    }
  }
  restoreReferences(params)
  params.mutatedPreloadedTraceIds = new Set(params.mutatedPreloadedTraceIds as string[])
  params.connMap = new ConnectivityMap(
    (params.connMap as { netMap: Record<string, string[]> }).netMap,
  )
  return params as unknown as Params
}
