import {createHash} from "node:crypto"
import {mkdirSync,writeFileSync} from "node:fs"
import {TopologyMergingSolver} from "lib/solvers/TopologyMergingSolver/TopologyMergingSolver"
import {createOverlayGridTopology} from "../../tests/fixtures/createOverlayGridTopology"
const count=Number(process.argv[2]??16)
if(!Number.isSafeInteger(count)||count<1)throw Error("Expected positive grid count")
const input=createOverlayGridTopology(count),before=JSON.stringify(input),started=performance.now(),solver=new TopologyMergingSolver(input),work=(solver as unknown as {atomicRegions:unknown[]}).atomicRegions
let peakWorkingRegions=0
while(!solver.solved&&!solver.failed){solver.step();peakWorkingRegions=Math.max(peakWorkingRegions,work.length)}
if(!solver.solved)throw Error(solver.error??"Topology did not complete")
const solveMs=performance.now()-started,output=solver.getOutput(),outputSha256=createHash("sha256").update(JSON.stringify(output)).digest("hex")
if(JSON.stringify(input)!==before)throw Error("Input changed")
await new Promise<void>(resolve=>setImmediate(resolve));Bun.gc(true)
const memory=process.memoryUsage()
if(process.argv.includes("--visual")){
 const {getSvgFromGraphicsObject}=await import("graphics-debug"),{Resvg}=await import("@resvg/resvg-js")
 const svg=getSvgFromGraphicsObject(solver.visualize());mkdirSync("docs/completed-topology-working-memory",{recursive:true});writeFileSync("docs/completed-topology-working-memory/completed-mesh.svg",svg);writeFileSync("docs/completed-topology-working-memory/completed-mesh.png",new Resvg(svg).render().asPng())
}
console.log(JSON.stringify({scope:"Retained native topology state after successful validation, with completed solver/output still alive; full routing/DRC measured separately",count,inputSha256:createHash("sha256").update(before).digest("hex"),outputSha256,solved:solver.solved,failed:solver.failed,inputUnchanged:true,outputNodes:output.length,peakWorkingRegions,retainedWorkingRegions:work.length,solveMs,heapUsedAfterGc:memory.heapUsed,rssAfterGc:memory.rss,peakRssBytes:process.resourceUsage().maxRSS*1024},null,2))
