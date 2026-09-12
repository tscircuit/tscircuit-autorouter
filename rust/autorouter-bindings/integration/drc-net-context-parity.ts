import assert from "node:assert/strict"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "high-density-repair03/lib"
import { AutoroutingDrcEngine } from "../../../lib/bindings/repair/AutoroutingDrcEngine"
import { importReference } from "./tsReference"

const { AutoroutingDrcEngine } = await importReference<typeof import("high-density-repair03/lib/drc/AutoroutingDrcEngine")>("node_modules/high-density-repair03/lib/drc/AutoroutingDrcEngine.ts")

type Fixture = {
  name: string
  mapping: Record<string, string>
  sharedCanonical?: boolean
  expectedErrors: [number, number]
}

const fixtures: Fixture[] = [
  {
    name: "asymmetric-direct-net",
    mapping: { source_left: "left", source_right: "right", left: "final", right: "left" },
    expectedErrors: [0, 1],
  },
  {
    name: "one-additional-resolution",
    mapping: { source_left: "left", source_right: "right", left: "final", right: "final" },
    expectedErrors: [0, 0],
  },
  {
    name: "does-not-recursively-follow-chains",
    mapping: { source_left: "left", source_right: "right", left: "middle_left", right: "middle_right", middle_left: "final", middle_right: "final" },
    expectedErrors: [1, 1],
  },
  {
    name: "empty-mapping-uses-canonical-alias",
    mapping: { source_left: "", source_right: "" },
    sharedCanonical: true,
    expectedErrors: [0, 0],
  },
  {
    name: "absent-mapping-uses-canonical-alias",
    mapping: {},
    sharedCanonical: true,
    expectedErrors: [0, 0],
  },
  {
    name: "empty-and-absent-stay-unconnected",
    mapping: { source_left: "" },
    expectedErrors: [1, 1],
  },
]

for (const fixture of fixtures) {
  const connMap = new ConnectivityMap({})
  Object.assign(connMap.idToNetMap, fixture.mapping)
  const srj: SimpleRouteJson = {
    bounds: { minX: -2, minY: -2, maxX: 2, maxY: 2 },
    connections: ["source_left", "source_right"].map((name) => ({
      name, pointsToConnect: [], ...(fixture.sharedCanonical ? { netConnectionName: "shared" } : {}),
    })),
    obstacles: [], layerCount: 2, minTraceWidth: 0.1,
  }
  const traces: SimplifiedPcbTraces = ["source_left", "source_right"].map((name, index) => ({
    type: "pcb_trace", pcb_trace_id: `trace_${name}`, connection_name: name,
    route: [-1, 1].map((x) => ({ route_type: "wire", x, y: index * 0.15, width: 0.1, layer: "top" })),
  }))
  const expected = new AutoroutingDrcEngine(srj, { connMap })
  const actual = new AutoroutingDrcEngine(srj, { connMap })
  for (const [index, input] of [traces, [...traces].reverse()].entries()) {
    const reference = expected.evaluate(input)
    const result = actual.evaluate(input)
    assert.equal(reference.errors.length, fixture.expectedErrors[index], `${fixture.name} oracle order ${index}`)
    assert.equal(JSON.stringify(result), JSON.stringify(reference), `${fixture.name} result order ${index}`)
    assert.deepEqual(actual.lastRunStats, expected.lastRunStats, `${fixture.name} stats order ${index}`)
  }
  console.log(`${fixture.name}: both trace orders match frozen TypeScript bytes and stats`)
}
