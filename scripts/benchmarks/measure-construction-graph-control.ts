import {createHash} from "node:crypto"
import {mkdirSync,writeFileSync} from "node:fs"
import {AutoroutingPipelineSolver9_PreloadedTraceGraph} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph"
import {evaluateRelaxedDrc} from "lib/testing/evaluate-relaxed-drc"
import {convertSrjToGraphicsObject} from "lib/utils/convertSrjToGraphicsObject"
import {createConstructionGraphControl} from "../../tests/fixtures/createConstructionGraphControl"
const input=createConstructionGraphControl(),before=JSON.stringify(input),started=performance.now()
const solver=new AutoroutingPipelineSolver9_PreloadedTraceGraph(input,{cacheProvider:null,releaseGraphConstructionState:true} as any)
solver.solve()
if(!solver.solved||solver.failed)throw Error(solver.error??"Native construction control failed")
const traces=solver.getOutputSimplifiedPcbTraces(),drc=evaluateRelaxedDrc({inputSrj:input,srjWithPointPairs:solver.srjWithPointPairs!,routedTraces:traces})
if(drc.errors.length||JSON.stringify(input)!==before)throw Error("Native DRC/input preservation failed")
if(process.argv.includes("--visual")){
 const {getSvgFromGraphicsObject}=await import("graphics-debug"),{Resvg}=await import("@resvg/resvg-js")
 const svg=getSvgFromGraphicsObject(convertSrjToGraphicsObject(solver.getOutputSimpleRouteJson()));mkdirSync("docs/consumed-graph-construction",{recursive:true});writeFileSync("docs/consumed-graph-construction/completed-native-route.svg",svg);writeFileSync("docs/consumed-graph-construction/completed-native-route.png",new Resvg(svg).render().asPng())
}
console.log(JSON.stringify({scope:"Native full-routing/DRC control with requested construction-state release",inputSha256:createHash("sha256").update(before).digest("hex"),outputSha256:createHash("sha256").update(JSON.stringify(traces)).digest("hex"),solved:solver.solved,failed:solver.failed,drcErrors:drc.errors.length,inputUnchanged:true,traces:traces.length,retainedConstructionStages:[solver.edgeSolver,solver.availableSegmentPointSolver,solver.necessaryCrampedPortPointSolver,solver.preloadedTraceGraphSolver].filter(Boolean).length,elapsedMs:performance.now()-started,peakRssBytes:process.resourceUsage().maxRSS*1024},null,2))
