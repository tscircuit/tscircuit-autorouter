import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import * as checks from "@tscircuit/checks"
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import { createPipeline9AutoroutingDrcEvaluator } from "../../lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/createPipeline9AutoroutingDrcEvaluator"
import { createPipeline7HdRoutesToSimplifiedPcbTracesConverter } from "../../lib/autorouter-pipelines/AutoroutingPipeline7_MultiGraph/convertPipeline7HdRoutesToSimplifiedPcbTraces"
import { convertToCircuitJson } from "../../lib/utils/convertToCircuitJson"
import { convertSrjToGraphicsObject } from "../../lib/utils/convertSrjToGraphicsObject"
import { getSvgFromGraphicsObject } from "graphics-debug"

const [capturePath,nativePath,output]=process.argv.slice(2)
const captured=JSON.parse(gunzipSync(readFileSync(capturePath)).toString()).params
const native=JSON.parse(readFileSync(nativePath,"utf8"))
mkdirSync(output,{recursive:true})
const solver=new AutoroutingPipelineSolver9_PreloadedTraceGraph(captured.originalSrj,{cacheProvider:null})
const stageRows:unknown[]=[]
let previous=""
const chosen=new Set(["pipeline9JointDrcRepairSolver","effortCleanupSolver","lengthMatchingPostProcessingSolver","powerTraceExpansionSolver","none"])
while(!solver.solved && !solver.failed) {
 const phase=solver.getCurrentPhase()
 if(phase!==previous && chosen.has(phase)) {
  const routes=solver.getNewTracesBeforePowerExpansion()
  const evaluate=createPipeline9AutoroutingDrcEvaluator({inputSrj:solver.originalSrj,srjWithPointPairs:solver.srjWithPointPairs!,includeBoardClearance:true})
  const reference=evaluate(routes)
  const actual=reference.circuitJson.map(element=>{
   const id=element.type==="pcb_smtpad"?element.pcb_smtpad_id:element.type==="pcb_plated_hole"?element.pcb_plated_hole_id:element.type==="pcb_hole"?element.pcb_hole_id:undefined
   if(!id)return element
   return native.find((original:any)=>(original.pcb_smtpad_id??original.pcb_plated_hole_id??original.pcb_hole_id)===id)??element
  })
  const rules={minClearance:0.1}
  const count=(errors:any[])=>errors.filter(error=>error.type.endsWith("_error")).length
  const findings={overlap:count(checks.checkEachPcbTraceNonOverlapping(actual,rules)),padTrace:count(checks.checkPadTraceClearance(actual,rules)),viaTrace:count(checks.checkViaTraceClearance(actual,rules)),viaPad:count(checks.checkViaPadClearance(actual,rules)),viaSpacing:count(checks.checkDifferentNetViaSpacing(actual)),viaInPad:count(checks.checkViasInPads(actual))}
  const types:Record<string,number>={};for(const error of reference.errors)types[String(error.type)]=(types[String(error.type)]??0)+1
  const row={entering:phase,after:previous,findings,reference:types,vias:actual.filter(e=>e.type==="pcb_via").length,tracePoints:routes.reduce((n,t)=>n+t.route.length,0)}
  stageRows.push(row);console.log("GLIDER_STAGE_RESULT",JSON.stringify(row));writeFileSync(`${output}/stages.json`,JSON.stringify(stageRows,null,2))
  writeFileSync(`${output}/${phase}.traces.json`,JSON.stringify(routes));writeFileSync(`${output}/${phase}.circuit.json`,JSON.stringify(actual))
 }
 previous=phase
 solver.step()
}
console.log("GLIDER_SOLVE_RESULT",JSON.stringify({solved:solver.solved,failed:solver.failed,error:solver.error,phase:solver.getCurrentPhase()}))
if(solver.failed)throw Error(solver.error!)
const traces=solver.getOutputSimplifiedPcbTraces();writeFileSync(`${output}/output.traces.json`,JSON.stringify(traces))
writeFileSync(`${output}/output.svg`,getSvgFromGraphicsObject(convertSrjToGraphicsObject({...solver.originalSrj,traces}),{backgroundColor:"white"}))
