import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { gunzipSync, gzipSync } from "node:zlib"
import { createHash } from "node:crypto"

const checkout = "/workspace/hd-refinements-2026-10-28/legalization-conservative-qa"
const directory = "/workspace/hd-refinements-2026-10-28/artifacts/bug107-hd-capture"
const { ConnectivityMap } = await import(join(checkout, "node_modules/circuit-json-to-connectivity-map/dist/index.js"))
const { convertPipeline7HdRoutesToSimplifiedPcbTraces } = await import(join(checkout, "lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces.ts"))
const { evaluateRelaxedDrc } = await import(join(checkout, "lib/testing/evaluate-relaxed-drc.ts"))
const { addAutoroutingViaTraceIds } = await import(join(checkout, "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9JointDrcRepairSolver.ts"))
const { getPipeline9DrcErrorTraceIds, getPipeline9RouteIndexByTraceId } = await import(join(checkout, "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/pipeline9JointDrcRepairUtils.ts"))
const unpack = (name: string): any => JSON.parse(gunzipSync(readFileSync(join(directory, name))).toString(), (_key, value): any => value && typeof value === "object" && "__captureMapEntries" in value ? new Map(value.__captureMapEntries) : value)
const original = unpack("initial-hd-output.json.gz")
const context = unpack("pipeline-context.json.gz")
const params = unpack("full-hd-constructor-params.json.gz")
const mapping = JSON.parse(readFileSync(join(directory, "recombination-mapping.json"), "utf8"))
const connMap = new ConnectivityMap(context.connMapNetMap)
const originalBytes = JSON.stringify(original)
const variants = process.argv.slice(2)
const summaries: any[] = []
for (const variant of variants) {
  const candidate = structuredClone(original)
  for (const node of mapping.mapping) {
    const result = unpack(`${node.prefix}.${variant}.result.json.gz`)
    if (result.routes.length !== node.routes.length) throw new Error("Changed route topology")
    for (const [localIndex, entry] of node.routes.entries()) {
      const source = result.routes[localIndex]
      const old = candidate[entry.hdIndex]
      if (old.regionId !== node.nodeId || old.connectionName !== source.connectionName) throw new Error("Region/owner mismatch")
      candidate[entry.hdIndex] = { ...old, route: source.route, vias: source.vias }
    }
  }
  if (variant === "actual" && JSON.stringify(candidate) !== originalBytes) throw new Error("Actual recombination did not exactly recover captured initial HD output")
  const traces = convertPipeline7HdRoutesToSimplifiedPcbTraces({ connections: context.newConnections, originalConnections: context.originalSrj.connections, hdRoutes: candidate, layerCount: params.layerCount, obstacles: params.obstacles, defaultViaHoleDiameter: params.viaHoleDiameter, connMap })
  if (traces.length !== candidate.length) throw new Error(`Conversion omitted initialHD routes: ${traces.length}/${candidate.length}`)
  const routeIndexByTraceId = getPipeline9RouteIndexByTraceId({ routes: candidate, newConnections: context.newConnections, syntheticConnectionNames: new Set() })
  for (const rules of ["relaxed", "declared"]) {
    const result = evaluateRelaxedDrc({ inputSrj: context.originalSrj, srjWithPointPairs: context.srjWithPointPairs, routedTraces: traces, includeBoardClearance: true, drcOptions: { includeTraceContinuity: false, ...(rules === "declared" ? { traceClearance: context.originalSrj.minTraceToPadEdgeClearance, viaClearance: context.originalSrj.minViaHoleEdgeToViaHoleEdgeClearance } : {}) } })
    const errors = addAutoroutingViaTraceIds({ errors: result.errors as any[], circuitJson: result.circuitJson, evaluatedTraceIds: new Set(traces.map((trace): string => trace.pcb_trace_id)) })
    const byType: Record<string, number> = {}, crossByType: Record<string, number> = {}, sameByType: Record<string, number> = {}, unknownByType: Record<string, number> = {}
    const classified = errors.map((error: any): any => {
      const type = String(error.type)
      byType[type] = (byType[type] ?? 0) + 1
      const traceIds = getPipeline9DrcErrorTraceIds(error)
      const regions = traceIds.map((id): string | null => { const index = routeIndexByTraceId.get(id); return index === undefined ? null : candidate[index].regionId })
      const unique = new Set(regions.filter((id): id is string => id !== null))
      const bucket = unique.size > 1 ? crossByType : unique.size === 1 && traceIds.length > 1 ? sameByType : unknownByType
      bucket[type] = (bucket[type] ?? 0) + 1
      return { ...error, diagnosticTraceIds: traceIds, diagnosticRegions: regions, crossRegion: unique.size > 1 }
    })
    const row = { variant, rules, errorCount: errors.length, byType, crossRegionByType: crossByType, sameRegionByType: sameByType, singleOrUnknownRegionByType: unknownByType, convertedTraces: traces.length, initialHdRouteCount: candidate.length, inputRouteSha256: createHash("sha256").update(JSON.stringify(candidate)).digest("hex"), sourceHead: "2f77750b872ddfeae0026987de3bf01e253f9992", noTraceContinuityCheck: "Pre-stitch HD segments intentionally evaluated for physical copper/drill/board constraints only.", scope: "Offline substitution of per-node grown physical proposals into EXACT captured initialHD output. No downstream routing, native search, final board, timing or success-rate claim.", timingComparisonValid: false }
    writeFileSync(join(directory, `recombined-${variant}-${rules}.errors.json.gz`), gzipSync(JSON.stringify(classified)))
    writeFileSync(join(directory, `recombined-${variant}-${rules}.summary.json`), JSON.stringify(row, null, 2))
    summaries.push(row)
    console.log(JSON.stringify(row), undefined, undefined)
  }
  writeFileSync(join(directory, `recombined-${variant}.routes.json.gz`), gzipSync(JSON.stringify(candidate)))
}
if (JSON.stringify(original) !== originalBytes) throw new Error("Recombination mutated original captured output")
writeFileSync(join(directory, "recombined-last-batch-summary.json"), JSON.stringify(summaries, null, 2))
