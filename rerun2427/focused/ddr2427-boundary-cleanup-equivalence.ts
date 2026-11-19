import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { gunzipSync } from "node:zlib"
import { prepareFanoutBuses as frozen } from "/workspace/fanout-completion-2427/lib/prepare-buses.ts"
import { prepareFanoutBuses as cleaned } from "/workspace/fanout-boundary-contact-repro-2427/lib/prepare-buses.ts"
const reports=[]
for (const board of ["icepi","imx6","h616","orangecrab","butterstick","glider"]) {
 const serialized=gunzipSync(readFileSync(`/workspace/ddr-rerun-2427/baseline/boards/${board}/fanout-1-input.json.gz`)).toString()
 const captured=JSON.parse(serialized)
 const before=frozen(captured.solverParams,captured.solverOptions)
 const after=cleaned(captured.solverParams,captured.solverOptions)
 const signature=(buses)=>JSON.stringify(buses.map(bus=>({busId:bus.busId,direction:bus.direction,preferredExit:bus.preferredExit,exitEdge:bus.exitEdge})))
 const beforeSignature=signature(before),afterSignature=signature(after)
 if(beforeSignature!==afterSignature) throw new Error(`Changed native bus directions during cleanup: ${board}`)
 let toleratedOutsideTargets=0
 const bounds=captured.solverOptions.sharedBoundary
 for(const bus of before)for(const connection of bus.connections){
  if(bus.termination.type==="plane")continue
  const p=connection.exitTargetPoint??connection.targetPoint
  const distances=[p.x-bounds.minX,bounds.maxX-p.x,p.y-bounds.minY,bounds.maxY-p.y]
  if(distances.some(d=>d<0)&&distances.every(d=>d>=-1e-6))toleratedOutsideTargets++
 }
 reports.push({board,inputSha256:createHash("sha256").update(serialized).digest("hex"),buses:before.length,matchingDirectionSha256:createHash("sha256").update(beforeSignature).digest("hex"),toleratedOutsideTargets})
}
await Bun.write("/tmp/ddr2427-boundary-cleanup-equivalence.json",JSON.stringify(reports,null,2))
console.log(JSON.stringify(reports,null,2))
