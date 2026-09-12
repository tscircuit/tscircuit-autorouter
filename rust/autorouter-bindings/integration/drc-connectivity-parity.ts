import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "high-density-repair03/lib"
import { importReference } from "./tsReference"
const { AutoroutingDrcEngine: ReferenceDrcEngine } = await importReference<typeof import("high-density-repair03/lib/drc/AutoroutingDrcEngine")>("node_modules/high-density-repair03/lib/drc/AutoroutingDrcEngine.ts")
import { AutoroutingDrcEngine } from "../../../lib/bindings/repair/AutoroutingDrcEngine"
import { loadAutorouterBindings } from "../ts/index"

await loadAutorouterBindings({ module_or_path: readFileSync(new URL("../pkg/autorouter_bindings_bg.wasm", import.meta.url)) })
const srj: SimpleRouteJson = {
  bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
  connections: ["a", "b"].map((name) => ({ name, pointsToConnect: [] })),
  obstacles: [], layerCount: 2, minTraceWidth: 0.1,
}
const traces: SimplifiedPcbTraces = ["a", "b"].map((name, index) => ({
  type: "pcb_trace", pcb_trace_id: `trace_${name}`, connection_name: name,
  route: [-1, 1].map((x) => ({ route_type: "wire", x, y: index * 0.15, width: 0.1, layer: "top" })),
}))
const connMap = new ConnectivityMap({})
connMap.addConnections([["a", "alias_a"], ["b", "alias_b"]])
const expected = new ReferenceDrcEngine(srj, { connMap })
const actual = new AutoroutingDrcEngine(srj, { connMap })
for (let phase = 0; phase < 2; phase++) {
  if (phase === 1) connMap.addConnections([["alias_a", "alias_b"]])
  const reference = expected.evaluate(traces)
  const result = actual.evaluate(traces)
  assert.equal(JSON.stringify(result), JSON.stringify(reference))
  assert.deepEqual(actual.lastRunStats, expected.lastRunStats)
  assert.equal(result.errorsWithCenters, result.locationAwareErrors)
  for (const error of result.errorsWithCenters) assert.ok(result.errors.includes(error))
  assert.equal(result.errors.length > 0, phase === 0)
}
console.log("Live connectivity merge and shared error references match TypeScript")
