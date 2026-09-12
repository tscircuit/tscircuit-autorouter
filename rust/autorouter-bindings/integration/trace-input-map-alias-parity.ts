import assert from "node:assert/strict"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { TraceSimplificationSolver } from "../../../lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver"
import { importReference } from "./tsReference"
const { TraceSimplificationSolver: Reference } = await importReference<typeof import("../../../lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver")>("lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver.ts")

function run(Solver: typeof Reference, phase: "via_removal" | "via_merging", observed: boolean): unknown {
  const oldLayers = new Set([0, 1])
  const terminals = new Map([["start", oldLayers], ["end", new Set([1])]])
  const nets = new Map([["a", "net"], ["b", "net"]])
  const routes = ["a", "b"].map((connectionName, index) => ({
    connectionName, rootConnectionName: "net", startPcbPortId: "start", endPcbPortId: "end", traceThickness: 0.1, viaDiameter: 0.3,
    route: [{x:0,y:index*0.1,z:0},{x:1,y:index*0.1,z:0},{x:1,y:index*0.1,z:1},{x:2,y:index*0.1,z:1}], vias:[{x:1,y:index*0.1}],
  }))
  const solver = new Solver({hdRoutes:routes,obstacles:[{type:"rect",layers:["top","bottom"],center:{x:0,y:0},width:0.4,height:0.4,connectedTo:["net"]}],connMap:new ConnectivityMap({net:["a","b"]}),colorMap:{},layerCount:2,defaultViaDiameter:0.3,terminalLayerIndicesByPcbPortId:terminals,netByConnectionName:nets})
  solver.currentPhase = phase
  solver.MAX_SIMPLIFICATION_PIPELINE_LOOPS = 1
  solver.step()
  const child = observed ? solver.activeSubSolver! : undefined
  const identities: boolean[] = []
  if (child && phase === "via_merging") identities.push(Reflect.get(child,"netByConnectionName") === nets)
  solver.step()
  const single = child && phase === "via_removal" ? Reflect.get(child,"activeSubSolver") : undefined
  if (single) identities.push(Reflect.get(single,"terminalLayerIndicesByPcbPortId") === terminals)
  oldLayers.delete(1)
  nets.set("b", "other")
  solver.step()
  const replacement = new Set([0, 1])
  terminals.set("start", replacement)
  oldLayers.add(3)
  nets.delete("a")
  nets.set("a", "net")
  solver.step()
  replacement.delete(1)
  if (single) {
    assert.equal(Reflect.get(single,"terminalLayerIndicesByPcbPortId").get("start"), replacement)
    const childMap = new Map([["start", oldLayers], ["end", new Set([1])]])
    Reflect.set(single,"terminalLayerIndicesByPcbPortId", childMap)
    oldLayers.delete(0)
    identities.push(Reflect.get(single,"terminalLayerIndicesByPcbPortId") === childMap)
  }
  if (child && phase === "via_merging") {
    const childMap = new Map([["a", "net"], ["b", "net"]])
    Reflect.set(child,"netByConnectionName", childMap)
    nets.set("b", "old-map-only")
    childMap.set("b", "other")
    identities.push(Reflect.get(child,"netByConnectionName") === childMap)
  }
  if (child && phase === "via_merging") identities.push(Reflect.get(child,"netByConnectionName") !== nets)
  while (!solver.solved && !solver.failed) {
    assert.ok(solver.iterations < 10000)
    solver.step()
  }
  const result = {routes:solver.simplifiedHdRoutes,iterations:solver.iterations,failed:solver.failed,error:solver.error,identities,terminals:[...terminals].map(([key,set])=>[key,[...set]]),nets:[...nets]}
  if (solver instanceof TraceSimplificationSolver) solver.dispose()
  return result
}
for (const phase of ["via_removal", "via_merging"] as const) {
  for (const observed of [false,true]) {
    console.log(`Checking ${phase} observed=${observed}`)
    assert.deepEqual(run(TraceSimplificationSolver,phase,observed),run(Reference,phase,observed),`${phase} observed=${observed}`)
  }
}
console.log("Live terminal Map/Set and explicit-net Map edits preserve active-child routing, identities and insertion order")
