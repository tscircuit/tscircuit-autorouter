import assert from "node:assert/strict"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { initializeTinyHypergraphBindings } from "../../../lib/bindings/initializeTinyHypergraphBindings"
import { DuplicateCongestedPortSolver, orderConnectionsByNetCardinality } from "../ts/index"

if (process.argv[2]) process.env.TSCIRCUIT_TS_REFERENCE = process.argv[2]
const { importReference } = await import("../../autorouter-bindings/integration/tsReference")
const { DuplicateCongestedPortSolver: TsDuplicateCongestedPortSolver } = await importReference<{
  DuplicateCongestedPortSolver: typeof DuplicateCongestedPortSolver
}>("node_modules/tiny-hypergraph/lib/DuplicateCongestedPortSolver.ts")
const { orderConnectionsByNetCardinality: tsOrderConnectionsByNetCardinality } = await importReference<{
  orderConnectionsByNetCardinality: typeof orderConnectionsByNetCardinality
}>("node_modules/tiny-hypergraph/lib/selective-rerip-tiny-hyper-graph-solver.ts")
initializeTinyHypergraphBindings()

// Shared-port fixtures exercise the original DuplicateCongestedPortSolver contract:
// independent routing, metadata cloning, locale ordering, geometry and ID collisions.
function createGraph(diagonal: boolean, collision: boolean, unicode: boolean): SerializedHyperGraph {
  const ids = unicode ? ["a-port", "A-port"] : ["p0", "p1"]
  const ports = ids.map((portId, i) => ({
    portId,
    region1Id: "middle",
    region2Id: i === 0 ? "west" : "east",
    d: { x: i === 0 ? -1 : 1, y: diagonal ? (i === 0 ? -0.137 : 0.319) : 0, z: 0,
      metadata: { zebra: 2, alpha: 1 }, tinyHypergraphPortPenalty: 0.7 },
  }))
  if (collision) ports.push({ ...ports[0]!, portId: `${ids[0]}::dup1`, d: { ...ports[0]!.d, x: -1.01, y: -0.23 } })
  return {
    regions: [
      { regionId: "west", pointIds: [ids[0]!, ...(collision ? [`${ids[0]}::dup1`] : [])], d: { center: { x: -2, y: diagonal ? -0.8 : 0 }, width: 1, height: 1 } },
      { regionId: "middle", pointIds: ports.map((port) => port.portId), d: { center: { x: 0, y: 0 }, width: 2, height: 2 } },
      { regionId: "east", pointIds: [ids[1]!], d: { center: { x: 2, y: diagonal ? 0.9 : 0 }, width: 1, height: 1 } },
    ],
    ports,
    connections: Array.from({ length: 3 }, (_, i) => ({ connectionId: `route-${i}`, startRegionId: "west", endRegionId: "east", mutuallyConnectedNetworkId: `net-${i}`, customMetadata: { zebra: "z", alpha: "a" } })),
  }
}

let checked = 0
for (const diagonal of [false, true]) {
  for (const collision of [false, true]) {
    for (const unicode of [false, true]) {
      for (const useSerializedPortPenalties of [false, true]) {
        const graph = createGraph(diagonal, collision, unicode)
        const before = JSON.stringify(graph)
        const options = { duplicatePortProximity: 0.05, useSerializedPortPenalties, routeSolveOptions: { MAX_ITERATIONS: 1000, RIP_THRESHOLD_RAMP_ATTEMPTS: 0, STATIC_REACHABILITY_PRECHECK: true } }
        const ts = new TsDuplicateCongestedPortSolver(graph, options)
        const wasm = new DuplicateCongestedPortSolver(graph, options)
        ts.solve()
        wasm.solve()
        const label = JSON.stringify({ diagonal, collision, unicode, useSerializedPortPenalties })
        assert.equal(wasm.failed, ts.failed, `${label}: failed`)
        assert.equal(wasm.solved, ts.solved, `${label}: solved`)
        assert.equal(wasm.error, ts.error ?? null, `${label}: error`)
        assert.equal(JSON.stringify(wasm.report), JSON.stringify(ts.report), `${label}: report bytes`)
        if (!ts.failed) assert.equal(JSON.stringify(wasm.getOutput()), JSON.stringify(ts.getOutput()), `${label}: graph bytes`)
        assert.equal(JSON.stringify(graph), before, `${label}: input unchanged`)
        checked++
      }
    }
  }
}
const connections = ["a", "b", "a", "c", "b", "a", "d"].map((net, index) => ({ net, index }))
const expected = tsOrderConnectionsByNetCardinality(connections, (connection: typeof connections[number]) => connection.net)
const actual = orderConnectionsByNetCardinality(connections, (connection) => connection.net)
assert.equal(JSON.stringify(actual), JSON.stringify(expected))
for (let i = 0; i < actual.length; i++) assert.equal(actual[i], expected[i], "ordering preserves object identity")
console.log(`Passed ${checked} duplicate-port byte comparisons and connection ordering/identity parity`)
