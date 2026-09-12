import assert from "node:assert/strict"
import type { GlobalDrcForceImproveSolverParams } from "high-density-repair03/lib"
import { GlobalDrcForceImproveSolver } from "../../../lib/bindings/repair/GlobalDrcForceImproveSolver"

const params: GlobalDrcForceImproveSolverParams = {
  srj: { bounds: { minX:-2,minY:-2,maxX:2,maxY:2 }, connections:[{name:"a",pointsToConnect:[]}], obstacles:[],layerCount:2,minTraceWidth:0.1 },
  hdRoutes:[{connectionName:"a",traceThickness:0.1,viaDiameter:0.3,route:[{x:-1,y:0,z:0},{x:1,y:0,z:0}],vias:[]}],
  maxIterations:2,enableBroadFallback:false,enablePostSolveClearanceRelaxation:false,
}
const solver = new GlobalDrcForceImproveSolver(params)
Reflect.get(solver, "getBinding").call(solver)
const capture = (): unknown[] => Reflect.get(solver, "captureMutations").call(solver)
const arrays = Reflect.get(solver, "routeArrays") as Map<number, unknown[]>
const encode = Reflect.get(solver, "encodeArray") as (id: number, routes: unknown[]) => unknown
const fingerprints = new Map<number, string>(Reflect.get(solver, "fingerprints"))
let encodes = 0
Reflect.set(solver, "encodeArray", function(this: GlobalDrcForceImproveSolver, id: number, routes: unknown[]): unknown {
  encodes++
  return encode.call(this, id, routes)
})
function compare(label: string): void {
  const expected: unknown[] = []
  for (const [id, routes] of arrays) {
    const packet = encode.call(solver, id, routes)
    const json = JSON.stringify(packet)
    if (json !== fingerprints.get(id)) {
      expected.push(packet)
      fingerprints.set(id, json)
    }
  }
  assert.equal(JSON.stringify(capture()), JSON.stringify(expected), label)
}
compare("initial graph")
const before = encodes
compare("unchanged graph")
assert.equal(encodes, before, "Unchanged graph must not allocate serialization packets")
const route = params.hdRoutes[0]!
const metadata = { nested: { amount: 1 }, optional: undefined as number | undefined }
Reflect.set(route, "metadata", metadata)
compare("metadata addition")
metadata.nested.amount = 2
compare("nested retained-object mutation")
metadata.optional = Number.NaN
compare("undefined to nonfinite")
Reflect.deleteProperty(metadata, "optional")
compare("own-key removal")
Reflect.set(metadata, "optional", undefined)
compare("explicit undefined addition")
route.route[0] = { ...route.route[0]! }
compare("same-valued point identity replacement")
route.route.reverse()
compare("point order")
const oldNested = metadata.nested
metadata.nested = { ...oldNested }
compare("same-valued nested replacement")
oldNested.amount = 3
compare("detached old nested mutation")
metadata.nested.amount = 4
compare("replacement nested mutation")
const last = encodes
compare("unchanged after all mutations")
assert.equal(encodes, last, "Updated baselines must also skip unchanged packet allocation")
console.log("Mutation scan matches original JSON fingerprints across nested values, own keys, order and identities; unchanged graphs allocate no packets")
