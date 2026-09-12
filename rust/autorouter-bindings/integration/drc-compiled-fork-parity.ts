import assert from "node:assert/strict"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { SimpleRouteJson, SimplifiedPcbTraces } from "high-density-repair03/lib"
import { AutoroutingDrcEngine } from "../../../lib/bindings/repair/AutoroutingDrcEngine"
import { importReference } from "./tsReference"
const { AutoroutingDrcEngine } = await importReference<typeof import("high-density-repair03/lib/drc/AutoroutingDrcEngine")>("node_modules/high-density-repair03/lib/drc/AutoroutingDrcEngine.ts")
const srj: SimpleRouteJson = {
  bounds:{minX:-2,minY:-2,maxX:2,maxY:2},connections:["a","b"].map(name=>({name,pointsToConnect:[]})),
  obstacles:[{type:"rect",center:{x:0,y:0},width:0.2,height:0.2,layers:["top"],connectedTo:["pcb_smtpad_1","b"]}],layerCount:2,minTraceWidth:0.1,
}
const traces: SimplifiedPcbTraces = ["a","b"].map((name,index)=>({type:"pcb_trace",pcb_trace_id:`trace_${name}`,connection_name:name,
  route:[-1,1].map(x=>({route_type:"wire",x,y:index*0.15,width:0.1,layer:"top"})),
}))
const initialMap=new ConnectivityMap({a:["a"],b:["b","pcb_smtpad_1"]})
const referenceMap=Object.assign(new ConnectivityMap({}),structuredClone(initialMap))
const reference=new AutoroutingDrcEngine(structuredClone(srj),{connMap:referenceMap})
const original=new AutoroutingDrcEngine(srj,{connMap:initialMap})
const baseline=original.evaluate(traces)
assert.equal(JSON.stringify(baseline),JSON.stringify(reference.evaluate(traces)))
assert.ok(baseline.errors.length>0,"Fixture must exercise ordered error output")
const originalStats=original.lastRunStats
const fork=original.forkForRepair()
try {
  assert.equal(JSON.stringify(fork.evaluateJson(JSON.stringify(traces),true)),JSON.stringify(baseline))
  assert.deepEqual(original.lastRunStats,originalStats,"Fork evaluations must not mutate original stats")
  initialMap.addConnections([["a","b"]])
  assert.equal(original.evaluate(traces).errors.length,0)
  assert.equal(JSON.stringify(fork.evaluateJson(JSON.stringify(traces),true)),JSON.stringify(baseline),"Fork connectivity remains its constructor snapshot")
  const forkStats=fork.stats()
  original.evaluate([])
  assert.deepEqual(fork.stats(),forkStats,"Original evaluations must not mutate fork stats")
  srj.obstacles[0]!.width=9
  assert.equal(JSON.stringify(fork.evaluateJson(JSON.stringify(traces),true)),JSON.stringify(baseline),"Compiled obstacle snapshot remains immutable")
  fork.setConnectivity({idToNetMap:initialMap.idToNetMap})
  assert.equal((fork.evaluateJson(JSON.stringify(traces),true) as typeof baseline).errors.length,0)
  referenceMap.addConnections([["a","b"]])
  assert.equal(JSON.stringify(original.evaluate(traces)),JSON.stringify(reference.evaluate(traces)))
} finally { fork.free() }
console.log("Compiled DRC fork preserves frozen baseline/error order and immutable geometry with independent mutable connectivity/stats")
