import assert from "node:assert/strict"
import type { DrcEvaluator, GlobalDrcForceImproveSolverParams, HighDensityRoute, SimpleRouteJson } from "high-density-repair03/lib"
import { GlobalDrcForceImproveSolver } from "../../../lib/bindings/repair/GlobalDrcForceImproveSolver"
import { importReference } from "./tsReference"

const { GlobalDrcForceImproveSolver: ReferenceSolver, AutoroutingDrcEngine } = await importReference<typeof import("high-density-repair03/lib")>("node_modules/high-density-repair03/lib/index.ts")
const template: GlobalDrcForceImproveSolverParams = {
  srj:{bounds:{minX:-2,minY:-2,maxX:2,maxY:2},connections:["a","b"].map(name=>({name,pointsToConnect:[]})),obstacles:[],layerCount:2,minTraceWidth:0.1,minViaDiameter:0.3},
  hdRoutes:["a","b"].map((connectionName,index)=>({connectionName,traceThickness:0.1,viaDiameter:0.3,route:[-1,0,1].map(x=>({x,y:index*0.12,z:0})),vias:[]})),
  maxIterations:2,enableBroadFallback:false,enablePostSolveClearanceRelaxation:false,
}
function run(Solver: typeof ReferenceSolver): { calls: unknown[]; output: HighDensityRoute[]; stats: unknown; state: unknown } {
  const params=structuredClone(template)
  const engine=new AutoroutingDrcEngine(params.srj)
  let owner: InstanceType<typeof ReferenceSolver> | undefined
  const arrays=new WeakMap<object,number>()
  arrays.set(params.hdRoutes,0)
  let nextId=1
  const calls: unknown[]=[]
  const id=(routes:object): number => {
    const prior=arrays.get(routes)
    if(prior!==undefined)return prior
    const result=nextId++;arrays.set(routes,result);return result
  }
  const evaluator:DrcEvaluator=(input)=>{
    const routes=input.routes!
    calls.push({kind:"evaluate",id:id(routes),traces:input.traces,srjSame:input.srj===params.srj,
      outputId:owner?id(owner.outputHdRoutes):null,iterations:owner?.iterations,max:owner?.MAX_ITERATIONS})
    return engine.evaluate(input.traces) as ReturnType<DrcEvaluator>
  }
  const reference:DrcEvaluator=()=>{throw new Error("Reference cache should satisfy the callback")}
  reference.getCachedResult=(input)=>{
    calls.push({kind:"cache",id:id(input.routes!),traces:input.traces,hdAlias:input.hdRoutes===input.routes,srjSame:input.srj===params.srj})
    return {errors:[]}
  }
  params.drcEvaluator=evaluator;params.referenceDrcEvaluator=reference
  owner=new Solver(params)
  owner.solve()
  return {calls,output:owner.getOutput(),stats:owner.stats,state:{solved:owner.solved,failed:owner.failed,error:owner.error,iterations:owner.iterations}}
}
const expected=run(ReferenceSolver)
const actual=run(GlobalDrcForceImproveSolver)
assert.equal(JSON.stringify(actual),JSON.stringify(expected),"Custom/reference callback calls, route identity, detached owner observations and final results")
for(const Solver of [ReferenceSolver,GlobalDrcForceImproveSolver]) {
  const sentinel=new Error("global DRC sentinel")
  const params=structuredClone(template)
  params.drcEvaluator=()=>{throw sentinel}
  const solver=new Solver(params)
  assert.throws(()=>solver.step(),error=>error===sentinel)
  assert.equal(solver.failed,true)
  assert.equal(solver.error,"GlobalDrcForceImproveSolver error: Error: global DRC sentinel")
}
console.log(`Custom/reference cache callbacks, route aliases, owner observations and original thrown Error identity match (${actual.calls.length} callbacks)`)
