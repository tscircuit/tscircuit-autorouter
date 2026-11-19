import { gunzipSync } from 'node:zlib'
import { readFileSync } from 'node:fs'
import { prepareFanoutBuses } from '/workspace/fanout-boundary-contact-repro-2427/lib/prepare-buses.ts'
import { getInitialViaPoint } from '/workspace/fanout-boundary-contact-repro-2427/lib/route-bus/source-escape.ts'
import { distancePointToObstacle } from '/workspace/fanout-boundary-contact-repro-2427/lib/geometry.ts'
const captured=JSON.parse(gunzipSync(readFileSync('/workspace/ddr-rerun-2427/baseline/boards/orangecrab/fanout-1-input.json.gz')).toString())
const input={...captured.solverParams,connections:captured.solverParams.connections.filter(c=>c.name==='breakout:pcb_breakout_point_5'),buses:[]}
const bus=prepareFanoutBuses(input,{...captured.solverOptions,buses:[]})[0]
const reports=[]
for(const direction of ['right','down'] as const)for(const viaHandedness of [-1,1] as const){
 const center=getInitialViaPoint({preparedConnection:bus.connections[0],bus:{...bus,direction},targetLayer:'inner2',traceWidth:.089,viaDiameter:.28,clearance:.089,viaHandedness})
 const blockers=input.obstacles.filter(o=>!o.isCopperPour&&distancePointToObstacle(center,o)<.28/2+.089-1e-9).map(o=>({obstacle:o.circuitJsonMetadata??o.obstacleId,center:o.center,layers:o.layers,width:o.width,height:o.height,actualClearance:distancePointToObstacle(center,o),requiredClearance:.229}))
 reports.push({direction,viaHandedness,center,blockers})
}
await Bun.write('/tmp/ddr2427-orange-boundary-blockers.json',JSON.stringify(reports,null,2));console.log(JSON.stringify(reports,null,2))
