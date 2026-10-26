import {createHash} from "node:crypto"
import {resolve} from "node:path"
import {pathToFileURL} from "node:url"
import {createOwnedTargetEscapeInput} from "../../tests/fixtures/createOwnedTargetEscapeInput"
const repository=resolve(Bun.argv[2]!),destination=Bun.argv[3]!,count=Number(Bun.argv[4]??128)
const {CapacityMeshEdgeSolver2_NodeTreeOptimization}=await import(pathToFileURL(resolve(repository,"lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver2_NodeTreeOptimization.ts")).href)
const columns=Math.ceil(Math.sqrt(count)),input=Array.from({length:count},(_,i)=>createOwnedTargetEscapeInput().map(n=>({...n,capacityMeshNodeId:`${n.capacityMeshNodeId}_${i}`,center:{x:n.center.x+(i%columns)*3,y:n.center.y+Math.floor(i/columns)*3},_targetConnectionName:n._targetConnectionName?`supply_${i}`:undefined,_connectedTo:n._connectedTo?[`supply_${i}`]:undefined}))).flat()
const original=JSON.stringify(input),times:number[]=[]
let row
for(let trial=0;trial<4;trial++) {
  const solver=new CapacityMeshEdgeSolver2_NodeTreeOptimization(input),started=performance.now()
  let error:string|null=null
  try{solver.solve()}catch(cause){error=String(cause)}
  const elapsedMs=performance.now()-started
  if(trial)times.push(elapsedMs)
  row={count,solved:solver.solved,failed:solver.failed,error,edges:solver.edges.length,inputUnchanged:original===JSON.stringify(input),inputSha256:createHash("sha256").update(original).digest("hex"),orderedEdgeSha256:createHash("sha256").update(JSON.stringify(solver.edges)).digest("hex"),peakRssBytes:process.resourceUsage().maxRSS*1024}
}
times.sort((a,b)=>a-b)
await Bun.write(destination,JSON.stringify({...row,medianMs:times[1],trialsMs:times},null,2)+"\n")
