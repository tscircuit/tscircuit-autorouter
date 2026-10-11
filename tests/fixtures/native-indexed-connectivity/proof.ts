import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { deepStrictEqual, strictEqual, ok } from "node:assert"
import { createPrivatelyMemoizedIndexedDrcEvaluator } from "../../../scripts/parallel-benchmark/prototypes/native-indexed-connectivity/createPrivatelyMemoizedIndexedDrcEvaluator"
import { Pipeline9MemoizedAutoroutingDrcEngine } from "lib/autorouter-pipelines/AutoroutingPipeline9_Parallel/repair03/Pipeline9MemoizedAutoroutingDrcEngine"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { RELAXED_DRC_OPTIONS } from "lib/testing/drcPresets"

type Fixture = { inputSrj: any; srjWithPointPairs: any; records: { record: number; routedTraces: any; drcOptions: any }[] }
function decode(value: any): any {
  if (value === null || typeof value !== "object") return value
  if (Object.hasOwn(value, "__indexedFixturePrimitive")) {
    switch (value.__indexedFixturePrimitive) {
      case "undefined": return undefined
      case "negative-zero": return -0
      case "NaN": return NaN
      case "Infinity": return Infinity
      case "-Infinity": return -Infinity
      default: throw new Error("Unknown indexed fixture primitive")
    }
  }
  if (Array.isArray(value)) return value.map(decode)
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decode(item)]))
}
export function collectNativeIndexedConnectivityProof(): Record<string, unknown> {
  const fixture = decode(JSON.parse(gunzipSync(new Uint8Array(readFileSync(new URL("./sample015-reference-geometries.json.gz", import.meta.url)))).toString())) as Fixture
  const input = fixture.inputSrj, source = fixture.srjWithPointPairs
  const srj = { ...source, obstacles: input.obstacles, minTraceWidth: input.minTraceWidth, minViaDiameter: input.minViaDiameter ?? 0.3 }
  const makeOptions = (): any => ({ connMap: getConnectivityMapFromSimpleRouteJson(structuredClone(source)),
    traceClearance: RELAXED_DRC_OPTIONS.traceClearance ?? 0.1, viaClearance: RELAXED_DRC_OPTIONS.viaClearance ?? 0.1,
    includeTraceViaOwnerMetadata: true, spatialCellSize: Math.max(0.3, input.minTraceWidth) + Math.max(RELAXED_DRC_OPTIONS.traceClearance ?? 0.1, RELAXED_DRC_OPTIONS.viaClearance ?? 0.1) })
  const candidate = createPrivatelyMemoizedIndexedDrcEvaluator(structuredClone(srj), makeOptions())
  const native = new Pipeline9MemoizedAutoroutingDrcEngine(structuredClone(srj), makeOptions())
  const rows: Record<string, unknown>[] = []
  for (const record of fixture.records) {
    const before = candidate.getStats(), expected = native.evaluate(structuredClone(record.routedTraces)), actual = candidate.evaluate(structuredClone(record.routedTraces))
    deepStrictEqual(actual, expected)
    deepStrictEqual(candidate.getRunStats(), native.lastRunStats)
    const after = candidate.getStats()
    rows.push({ record: record.record, errors: actual.errors.length, runStats: candidate.getRunStats(),
      originalPredicateCalls: after.originalPredicateCalls - before.originalPredicateCalls,
      memoHits: after.memoHits - before.memoHits, memoEntries: after.memoEntries - before.memoEntries,
      entryLimitSkips: after.entryLimitSkips - before.entryLimitSkips,
      sameNameFastReturns: after.sameNameFastReturns - before.sameNameFastReturns,
      guardObjects: after.guardObjects - before.guardObjects, guardVisits: after.guardVisits - before.guardVisits, guardProperties: after.guardProperties - before.guardProperties })
  }
  const totals = candidate.getStats()
  strictEqual(totals.admittedEvaluations, 17)
  strictEqual(totals.nativeEvaluations, 0)
  ok(totals.memoHits > 4_000_000)
  ok(totals.originalPredicateCalls > 0)
  // Live caller-owned inputs are revalidated; a fresh memo cannot retain an old
  // false connection after the original map changes between evaluate calls.
  const tiny = { layerCount: 2, minTraceWidth: 0.1, bounds: { minX: -1, maxX: 5, minY: -1, maxY: 5 }, obstacles: [], connections: [] }
  const netMap = getConnectivityMapFromSimpleRouteJson({ ...tiny, connections: [{ name: "a", pointsToConnect: [] }, { name: "b", pointsToConnect: [] }] } as any)
  const options = { connMap: netMap }, changing = createPrivatelyMemoizedIndexedDrcEvaluator(tiny as any, options), oracle = new Pipeline9MemoizedAutoroutingDrcEngine(tiny as any, options)
  const wire = (id: string, y: number): any => ({ type: "pcb_trace", pcb_trace_id: id, connection_name: id, route: [
    { route_type: "wire", x: 0, y, width: 0.1, layer: "top" }, { route_type: "wire", x: 4, y, width: 0.1, layer: "top" }] })
  const traces = [wire("a", 0), wire("b", 0.02)]
  deepStrictEqual(changing.evaluate(structuredClone(traces)), oracle.evaluate(structuredClone(traces)))
  netMap.addConnections([["a", "b"]])
  deepStrictEqual(changing.evaluate(structuredClone(traces)), oracle.evaluate(structuredClone(traces)))
  strictEqual(changing.getStats().admittedEvaluations, 2)
  const asymMap = new ConnectivityMap({ A: ["idA", "B"], P: ["A"], B: ["idB"] })
  strictEqual(asymMap.areIdsConnected("A", "B"), true)
  strictEqual(asymMap.areIdsConnected("B", "A"), false)
  const asymOptions = { connMap: asymMap }, asymmetric = createPrivatelyMemoizedIndexedDrcEvaluator(tiny as any, asymOptions), asymOracle = new Pipeline9MemoizedAutoroutingDrcEngine(tiny as any, asymOptions)
  const alternate = [wire("idA", 0), wire("idB", 0.02), { ...wire("idA", 0.04), pcb_trace_id: "secondA" }, { ...wire("idB", 0.06), pcb_trace_id: "secondB" }]
  const asymResult = asymOracle.evaluate(structuredClone(alternate))
  deepStrictEqual(asymmetric.evaluate(structuredClone(alternate)), asymResult)
  strictEqual(asymmetric.getStats().admittedEvaluations, 1)
  ok(asymmetric.getStats().memoHits > 0)
  ok(asymResult.errors.length > 0)
  const shared = ["aliasA", "aliasB"], aliasMap = new ConnectivityMap({ first: shared, second: shared })
  const aliasOptions = { connMap: aliasMap }, aliases = createPrivatelyMemoizedIndexedDrcEvaluator(tiny as any, aliasOptions), aliasOracle = new Pipeline9MemoizedAutoroutingDrcEngine(tiny as any, aliasOptions)
  deepStrictEqual(aliases.evaluate([wire("aliasA", 0), wire("aliasB", 0.02)]), aliasOracle.evaluate([wire("aliasA", 0), wire("aliasB", 0.02)]))
  strictEqual(aliases.getStats().admittedEvaluations, 1)
  const capped = createPrivatelyMemoizedIndexedDrcEvaluator(tiny as any), capOracle = new Pipeline9MemoizedAutoroutingDrcEngine(tiny as any)
  const crowded = Array.from({ length: 370 }, (_, index) => wire(`cap-${index}`, index * 0.0001))
  deepStrictEqual(capped.evaluate(structuredClone(crowded)), capOracle.evaluate(structuredClone(crowded)))
  strictEqual(capped.getStats().memoEntries, 65_536)
  ok(capped.getStats().entryLimitSkips > 0)
  deepStrictEqual(capped.getRunStats(), capOracle.lastRunStats)
  return { kind: "Dormant exact indexed-connectivity memo work proof; no production activation or timing claim", runtime: Bun.version,
    provenance: "17 saved sample015 native reference geometries reconstructed under original indexed-engine options, not all remote candidate evaluations",
    oracle: "Separate persistent same-source native engine; exact errors/order/centers and lastRunStats at every record",
    admission: "Engine module first under native reflection; full pre-helper collection/class/helper provenance and per-evaluate callback-free plain data graph",
    rows, totals, mutationBetweenEvaluations: true, asymmetricActualPairs: true, sharedNetArrayAliases: true, capacityLimitNativeSites: capped.getStats().entryLimitSkips }
}
