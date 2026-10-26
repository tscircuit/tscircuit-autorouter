import {createHash} from "node:crypto"
import {writeFileSync,mkdirSync} from "node:fs"
import {SingleTargetNecessaryCrampedPortPointSolver} from "lib/solvers/NecessaryCrampedPortPointSolver/SingleTargetNecessaryCrampedPortPointSolver"
import {createWideCrampedPortGraph} from "../../tests/fixtures/createWideCrampedPortGraph"

const count=Number(process.argv[2]??128)
if(!Number.isSafeInteger(count)||count<1)throw Error("Expected a positive graph size")
const trials=[];let report:Record<string,unknown>|undefined
for(let trial=0;trial<4;trial++) {
  const fixture=createWideCrampedPortGraph(count),input=JSON.stringify([...fixture.ports])
  const started=performance.now(),solver=new SingleTargetNecessaryCrampedPortPointSolver(fixture.input)
  solver.solve()
  const elapsedMs=performance.now()-started
  if(!solver.solved)throw Error(solver.error??"Native cramped-port graph did not solve")
  const output=solver.getOutput().map(candidate=>{
    const chain:string[]=[];let current:typeof candidate|null=candidate
    while(current){chain.push(current.port.segmentPortPointId);current=current.parent}
    return {depth:candidate.depth,cramped:candidate.countOfCrampedPortPointsInPath,chain}
  })
  if(JSON.stringify([...fixture.ports])!==input)throw Error("Native input graph changed")
  if(trial>0)trials.push(elapsedMs)
  report={scope:"Native candidate-search graph; physical copper/DRC measured separately by full routing benchmark",count,solved:solver.solved,failed:solver.failed,candidates:output.length,inputUnchanged:true,inputSha256:createHash("sha256").update(input).digest("hex"),outputSha256:createHash("sha256").update(JSON.stringify(output)).digest("hex"),adjacencyListReads:fixture.ports.getCalls,adjacencyEntriesRead:fixture.ports.adjacencyEntriesRead,peakRssBytes:process.resourceUsage().maxRSS*1024}
  if(process.argv.includes("--visual")&&trial===3) {
    const {getSvgFromGraphicsObject}=await import("graphics-debug"),{Resvg}=await import("@resvg/resvg-js")
    const graphics=solver.visualize()
    graphics.rects=[...fixture.input.mapOfCapacityMeshNodeIdToRef.values()].map(node=>({center:node.center,width:node.width,height:node.height,fill:node._containsObstacle?"rgba(220,50,50,.2)":"rgba(100,130,160,.1)",stroke:"#667788"}))
    graphics.texts=solver.getOutput().map(candidate=>({x:candidate.port.x,y:candidate.port.y+0.25,text:"retained exit",fontSize:0.18,anchorSide:"center"}))
    const svg=getSvgFromGraphicsObject(graphics)
    mkdirSync("docs/linear-cramped-port-search",{recursive:true})
    writeFileSync("docs/linear-cramped-port-search/completed-graph.svg",svg)
    writeFileSync("docs/linear-cramped-port-search/completed-graph.png",new Resvg(svg).render().asPng())
  }
}
console.log(JSON.stringify({...report,medianMs:[...trials].sort((a,b)=>a-b)[1],trialsMs:trials},null,2))
