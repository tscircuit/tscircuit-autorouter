import {readFileSync,writeFileSync} from "node:fs"
import {gunzipSync} from "node:zlib"
import {createHash} from "node:crypto"
import {AutoroutingPipelineSolver9_PreloadedTraceGraph} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import {createConstructionGraphControl} from "../../tests/fixtures/createConstructionGraphControl"
const destination=process.argv[2]??"am3352-graph-construction.json"
const raw=process.argv.includes("--control")?Buffer.from(JSON.stringify(createConstructionGraphControl())):gunzipSync(readFileSync("tests/fixtures/am3352-support-default-conversion.json.gz"))
const input=JSON.parse(raw.toString()),started=performance.now(),solver=new AutoroutingPipelineSolver9_PreloadedTraceGraph(input,{cacheProvider:null,effort:1,releaseGraphConstructionState:true} as any)
let lastPhase=""
while(!solver.solved&&!solver.failed&&!solver.portPointPathingSolver){
 const phase=solver.getCurrentPhase()
 if(phase!==lastPhase){console.log(JSON.stringify({phase,elapsedSeconds:(performance.now()-started)/1000,memory:process.memoryUsage(),capacityNodes:solver.capacityNodes?.length,capacityEdges:solver.capacityEdges?.length}));lastPhase=phase}
 const deadline=performance.now()+25
 do{solver.step()}while(!solver.solved&&!solver.failed&&!solver.portPointPathingSolver&&solver.getCurrentPhase()===lastPhase&&performance.now()<deadline)
 await new Promise<void>(resolve=>setImmediate(resolve))
}
const report={scope:"Controlled stop after native pathing-graph construction; this is not full-board routing",inputSha256:createHash("sha256").update(raw).digest("hex"),pathingGraphConstructed:!!solver.portPointPathingSolver,failed:solver.failed,error:solver.error,phase:solver.getCurrentPhase(),elapsedSeconds:(performance.now()-started)/1000,memory:process.memoryUsage(),peakRssBytes:process.resourceUsage().maxRSS*1024,releasedConstructionState:!solver.availableSegmentPointSolver&&!solver.necessaryCrampedPortPointSolver&&!solver.preloadedTraceGraphSolver,sourceInputUnchanged:JSON.stringify(input)===raw.toString()}
// Native fixture indentation is preserved for its SHA; compare parsed contents.
report.sourceInputUnchanged=JSON.stringify(input)===JSON.stringify(JSON.parse(raw.toString()))
writeFileSync(destination,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report))
if(!report.pathingGraphConstructed||report.failed)process.exitCode=1
