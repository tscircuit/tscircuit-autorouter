import {createHash} from "node:crypto"
import {resolve} from "node:path"
import {pathToFileURL} from "node:url"
import {createTargetEdgeGridInput} from "../../tests/fixtures/createTargetEdgeGridInput"
const repository=resolve(Bun.argv[2]!),destination=Bun.argv[3]!,count=Number(Bun.argv[4]??4096)
const {CapacityMeshEdgeSolver2_NodeTreeOptimization}=await import(pathToFileURL(resolve(repository,"lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver2_NodeTreeOptimization.ts")).href)
const input=createTargetEdgeGridInput(count), original=JSON.stringify(input), times:number[]=[]
let row
for(let trial=0;trial<4;trial++) {
 const solver=new CapacityMeshEdgeSolver2_NodeTreeOptimization(input),start=performance.now()
 solver.solve()
 const elapsedMs=performance.now()-start
 if(trial)times.push(elapsedMs)
 row={count,solved:solver.solved,failed:solver.failed,edges:solver.edges.length,inputUnchanged:JSON.stringify(input)===original,inputSha256:createHash("sha256").update(original).digest("hex"),outputSha256:createHash("sha256").update(JSON.stringify(solver.edges)).digest("hex"),peakRssBytes:process.resourceUsage().maxRSS*1024}
}
times.sort((a,b)=>a-b)
await Bun.write(destination,JSON.stringify({...row,medianMs:times[1],trialsMs:times},null,2)+"\n")
