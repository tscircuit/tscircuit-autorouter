import assert from "node:assert/strict"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import type { HighDensityRoute, Jumper } from "../../../lib/types/high-density-types"
import { TraceSimplificationSolver } from "../../../lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver"
import { importReference } from "./tsReference"
const { TraceSimplificationSolver: Reference }=await importReference<typeof import("../../../lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver")>("lib/solvers/TraceSimplificationSolver/TraceSimplificationSolver.ts")
function run(Solver:typeof Reference):unknown {
  const old: Jumper[]=[{route_type:"jumper",start:{x:0,y:0},end:{x:1,y:0},footprint:"0603"}]
  const next:Jumper[]=[{route_type:"jumper",start:{x:5,y:5},end:{x:6,y:5},footprint:"1206"}]
  const routes:HighDensityRoute[]=[{connectionName:"a",traceThickness:0.1,viaDiameter:0.3,route:[{x:0,y:0,z:0},{x:1,y:0,z:0}],vias:[],jumpers:old}]
  const solver=new Solver({hdRoutes:routes,obstacles:[],connMap:new ConnectivityMap({a:["a"]}),colorMap:{},layerCount:2,defaultViaDiameter:0.3})
  routes[0]!.jumpers=next
  old[0]!.start.y=0.2
  old.push({route_type:"jumper",start:{x:2,y:0},end:{x:3,y:0},footprint:"0603"})
  solver.MAX_SIMPLIFICATION_PIPELINE_LOOPS=0
  solver.solve()
  const output=solver.simplifiedHdRoutes
  const result={output,input:routes,old,next,outputOld:output[0]!.jumpers===old,inputNext:routes[0]!.jumpers===next,pointAlias:output[0]!.jumpers![0]!.start===old[0]!.start}
  if(solver instanceof TraceSimplificationSolver)solver.dispose()
  return result
}
assert.deepEqual(run(TraceSimplificationSolver),run(Reference))
console.log("Outer shallow copies retain old jumper arrays and live nested changes after input reassignment")
