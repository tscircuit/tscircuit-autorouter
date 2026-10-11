import { readFileSync, writeFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { canUseLazyViaTraceCenters } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/canUseLazyViaTraceCenters"
import { initializeReferenceDrcRuntime } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/initializeReferenceDrcRuntime"
import { getTraceSegments } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/authoritative-drc-fork/native/lib/check-pad-clearance/common"
import type { AnyCircuitElement, PcbVia } from "circuit-json"

type ViaLayerRetentionTotals = {
  vias: number
  retainedArrays: number
  originalGetLayersCalls: number
  retainedGetLayersCalls: number
  unchangedIncludesCalls: number
}
type ViaLayerRetentionRow = ViaLayerRetentionTotals & {
  record: number
  eligible: boolean
  segments: number
}

await initializeReferenceDrcRuntime()
const fixture = JSON.parse(gunzipSync(new Uint8Array(readFileSync(new URL(
  "../../tests/fixtures/reference-drc-srj18/sample015-native-reference.json.gz", import.meta.url,
)))).toString()) as { records: { circuitJson: AnyCircuitElement[] }[] }
const rows = fixture.records.map((record, index): ViaLayerRetentionRow => {
  const segments = getTraceSegments(record.circuitJson)
  const vias = record.circuitJson.filter((element): boolean => element.type === "pcb_via") as PcbVia[]
  const retained = vias.filter((via): boolean => Array.isArray(via.layers))
  return {
    record: index,
    eligible: canUseLazyViaTraceCenters(record.circuitJson, undefined, undefined),
    vias: vias.length,
    segments: segments.length,
    retainedArrays: retained.length,
    originalGetLayersCalls: vias.length * segments.length,
    retainedGetLayersCalls: (vias.length - retained.length) * segments.length,
    unchangedIncludesCalls: vias.length * segments.length,
  }
})
if (!rows.every((row): boolean => row.eligible)) throw new Error("A saved native via-layer domain was not eligible")
const report = {
  kind: "functional-work-only-no-timing",
  scope: "17 saved native sample015 DRC invocations with no diagnostics",
  method: "Exact loop-body invocation counts from each original via/segment Cartesian product; every original includes site is retained.",
  rows,
  totals: rows.reduce((totals, row): ViaLayerRetentionTotals => ({
    vias: totals.vias + row.vias,
    retainedArrays: totals.retainedArrays + row.retainedArrays,
    originalGetLayersCalls: totals.originalGetLayersCalls + row.originalGetLayersCalls,
    retainedGetLayersCalls: totals.retainedGetLayersCalls + row.retainedGetLayersCalls,
    unchangedIncludesCalls: totals.unchangedIncludesCalls + row.unchangedIncludesCalls,
  }), { vias: 0, retainedArrays: 0, originalGetLayersCalls: 0, retainedGetLayersCalls: 0, unchangedIncludesCalls: 0 }),
}
const serialized = `${JSON.stringify(report, null, 2)}\n`
if (process.argv[2]) writeFileSync(process.argv[2], serialized)
else process.stdout.write(serialized)
