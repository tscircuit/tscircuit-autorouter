import { createHash } from "node:crypto"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { createPartiallyCoveredTargetTopology } from "../../tests/fixtures/createPartiallyCoveredTargetTopology"
const repository=resolve(Bun.argv[2]!), destination=Bun.argv[3]!, count=Number(Bun.argv[4]??128)
const {TopologyMergingSolver}=await import(pathToFileURL(resolve(repository,"lib/solvers/TopologyMergingSolver/TopologyMergingSolver.ts")).href)
const input=createPartiallyCoveredTargetTopology()
for(const group of input.nodeGroups) {
 const template=group.nodes[0]!
 group.nodes=Array.from({length:count},(_,i)=>({...template,capacityMeshNodeId:`${template.capacityMeshNodeId}_${i}`,center:{x:template.center.x+i*1.5,y:template.center.y}}))
}
const original=JSON.stringify(input),times:number[]=[]
let result
for(let trial=0;trial<4;trial++) {
 const solver=new TopologyMergingSolver(input),start=performance.now()
 let error:string|null=null
 try {solver.solve()} catch(cause) {error=String(cause)}
 const elapsedMs=performance.now()-start
 if(trial)times.push(elapsedMs)
 const output=solver.solved&&!solver.failed?solver.getOutput():[]
 result={count,solved:solver.solved,failed:solver.failed,error,outputNodes:output.length,padArea:output.filter((n:any)=>n._targetConnectionName==="power").reduce((sum:number,n:any)=>sum+n.width*n.height,0),inputUnchanged:JSON.stringify(input)===original,inputSha256:createHash("sha256").update(original).digest("hex"),outputSha256:output.length?createHash("sha256").update(JSON.stringify(output)).digest("hex"):null,peakRssBytes:process.resourceUsage().maxRSS*1024}
}
times.sort((a,b)=>a-b)
await Bun.write(destination,JSON.stringify({...result,medianMs:times[1],trialsMs:times},null,2)+"\n")
