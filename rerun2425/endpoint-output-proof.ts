import assert from "node:assert/strict"
import { prepareFanoutBuses } from "/workspace/fanout-plane-static-candidate-2425/lib/prepare-buses"
import { getCopperLayerNames } from "/workspace/fanout-plane-static-candidate-2425/lib/layer-names"
import { routeBusAlternatives as before } from "/workspace/fanout-plane-layout-fix-2422/lib/route-bus"
import { routeBusAlternatives as after } from "/workspace/fanout-plane-static-candidate-2425/lib/route-bus"
import type { SimpleRouteJson } from "/workspace/fanout-plane-static-candidate-2425/node_modules/@tscircuit/capacity-autorouter"
import type { RouteBusParams } from "/workspace/fanout-plane-static-candidate-2425/lib/route-bus"
import { createIcepiPlaneDrop } from "/workspace/fanout-plane-static-candidate-2425/tests/fixtures/icepi-plane-drop"

function endpointFixture(): RouteBusParams {
  const name="VSS_A1"
  const srj:SimpleRouteJson={
    layerCount:4,minTraceWidth:0.1,nominalTraceWidth:0.1,minViaPadDiameter:0.25,minViaHoleDiameter:0.15,
    minTraceToPadEdgeClearance:0.1,minViaEdgeToPadEdgeClearance:0.1,defaultObstacleMargin:0.1,
    bounds:{minX:-2,maxX:2,minY:-2,maxY:2},
    connections:[{name,pointsToConnect:[{x:-.4,y:.4,layer:"top",pointId:"source",pcb_port_id:"source"},{x:-.1,y:.4,layer:"top",pointId:"endpoint",pcb_port_id:"endpoint"}]}],
    obstacles:[[-.4,.4],[.4,.4],[-.4,-.4],[.4,-.4]].map(([x,y],index)=>({obstacleId:`pad-${index}`,componentId:"bga",type:"rect",shape:"circle",center:{x,y},width:.3,height:.3,layers:["top"],connectedTo:index===0?[name,"source"]:[]})),
  }
  const spec={busId:"plane",connectionNames:[name],sourceComponentId:"bga",direction:"right" as const,termination:{type:"plane" as const,layer:"inner1"}}
  const options={buses:[spec],sharedBoundary:srj.bounds,escapeLayers:["top","bottom"],allowBlindAndBuriedVias:false}
  const bus=prepareFanoutBuses(srj,options)[0]!
  return {srj,bus,targetLayer:"inner1",acceptedPlans:[],layerNames:getCopperLayerNames(4),traceWidth:.1,viaDiameter:.25,viaHoleDiameter:.15,clearance:.1,compactBusTracks:true,allowBlindAndBuriedVias:false}
}
const reports=[]
for(const [label,create] of [["native",createIcepiPlaneDrop],["near-endpoint",endpointFixture]] as const){
 for(const maximum of [1,2,7]) {
  const params=create();const sharedCache=new Map<string,boolean>()
  const input={...params,staticClearanceCache:sharedCache}
  const cold=before(input,maximum)
  const warmBefore=before(input,maximum)
  const warmAfter=after(input,maximum)
  assert.deepStrictEqual(warmBefore,cold)
  assert.deepStrictEqual(warmAfter,cold)
  reports.push({label,maximum,alternatives:cold.length,planeEndpointPlans:cold.flat().filter(p=>p.planeEndpointTrace).length,staticCacheSize:sharedCache.size})
 }
}
console.log(JSON.stringify(reports,null,2))
