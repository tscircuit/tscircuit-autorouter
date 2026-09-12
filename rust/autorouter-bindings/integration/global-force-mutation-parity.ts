import assert from "node:assert/strict"
import type { GlobalDrcForceImproveSolverParams, HighDensityRoute } from "high-density-repair03/lib"
import { GlobalDrcForceImproveSolver } from "../../../lib/bindings/repair/GlobalDrcForceImproveSolver"
import { importReference } from "./tsReference"

const { GlobalDrcForceImproveSolver: ReferenceSolver, AutoroutingDrcEngine } = await importReference<typeof import("high-density-repair03/lib")>("node_modules/high-density-repair03/lib/index.ts")
const template: GlobalDrcForceImproveSolverParams = {
  srj: { bounds: { minX:-2,minY:-2,maxX:2,maxY:2 }, connections:["a","b"].map(name=>({name,pointsToConnect:[]})), obstacles:[],layerCount:2,minTraceWidth:0.1 },
  hdRoutes:["a","b"].map((connectionName,index)=>({connectionName,traceThickness:0.1,viaDiameter:0.3,route:[-1,0,1].map(x=>({x,y:index,z:0})),vias:[]})),
  maxIterations:2,enableBroadFallback:false,enablePostSolveClearanceRelaxation:false,
}
type Mode = "callback-layout" | "callback-replacement" | "input-before-step" | "guarded-before-step" | "throw-after-mutation" | "candidate-mutation"
function run(Solver:typeof ReferenceSolver,mode:Mode):unknown {
  const params=structuredClone(template)
  if(mode==="candidate-mutation")params.hdRoutes[1]!.route.forEach(point=>{point.y=0.12})
  const engine=new AutoroutingDrcEngine(params.srj)
  let owner:InstanceType<typeof ReferenceSolver>
  const sentinel=new Error("mutated callback")
  const observations:unknown[]=[]
  let calls=0
  params.drcEvaluator=input=>{
    const routes=input.routes!
    observations.push({routes:structuredClone(routes),outputAlias:owner.outputHdRoutes===routes})
    if(mode==="candidate-mutation" && calls===1) {
      routes[0]!.route.splice(1,1,{x:0.05,y:0.03,z:0})
      routes.reverse()
    }
    if(calls++===0) {
      if(mode==="callback-layout" || mode==="throw-after-mutation") {
        const first=routes[0]!
        first.route.splice(1,1,{x:0.2,y:0.4,z:0})
        routes.reverse()
        routes.push({...first,connectionName:"c",route:[...first.route],vias:[]})
      }
      if(mode==="callback-replacement") {
        routes[0]={...routes[0]!,route:routes[0]!.route.map(point=>({...point,y:point.y+0.2}))}
        owner.outputHdRoutes=[routes[0]!]
      }
      if(mode==="throw-after-mutation")throw sentinel
    }
    return mode==="candidate-mutation" ? engine.evaluate(input.traces) : {errors:[]}
  }
  owner=new Solver(params)
  if(mode==="input-before-step")params.hdRoutes.splice(0,1)
  if(mode==="guarded-before-step")owner.guardedInputHdRoutes.splice(0,1)
  const input=params.hdRoutes
  const first=input[0]!
  const points=first.route
  if(mode==="throw-after-mutation")assert.throws(()=>owner.step(),error=>error===sentinel)
  else owner.solve()
  if(mode==="candidate-mutation")assert.ok(calls>2,"Candidate mutation must occur inside the search loop")
  return {observations,output:owner.getOutput(),input,guarded:owner.guardedInputHdRoutes,outputIsInput:owner.getOutput()===input,
    firstRetained:input.includes(first),pointsRetained:first.route===points,stats:owner.stats,iterations:owner.iterations,solved:owner.solved,failed:owner.failed,error:owner.error}
}
for(const mode of ["callback-layout","callback-replacement","input-before-step","guarded-before-step","throw-after-mutation","candidate-mutation"] satisfies Mode[]) {
  assert.equal(JSON.stringify(run(GlobalDrcForceImproveSolver,mode)),JSON.stringify(run(ReferenceSolver,mode)),mode)
  console.log(`${mode}: callback/public mutations and retained identities match`)
}
