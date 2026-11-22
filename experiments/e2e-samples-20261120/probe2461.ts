import { readFileSync, writeFileSync, mkdirSync } from "node:fs"
import { gzipSync, gunzipSync } from "node:zlib"
import { FanoutSolver } from "./node_modules/@tscircuit/fanout-solver/lib/fanout-solver"
import { routeBus } from "./node_modules/@tscircuit/fanout-solver/lib/route-bus"
import { getComponentDogboneViaSiteCandidates } from "./node_modules/@tscircuit/fanout-solver/lib/match-component-dogbone-via-sites"
import { validateRoutedCopperDrc } from "./node_modules/@tscircuit/fanout-solver/lib/validate-routed-copper-drc"
import { distance, distancePointToObstacle } from "./node_modules/@tscircuit/fanout-solver/lib/geometry"
import { getPlanVias } from "./node_modules/@tscircuit/fanout-solver/lib/route-bus/plan-copper"
const sample=process.env.SAMPLE!,mode=process.env.MODE!
const folder="../captures/"+sample
const readJson=(p:string)=>JSON.parse(p.endsWith('.gz')?gunzipSync(readFileSync(p)).toString():readFileSync(p,'utf8'))
const report=readJson(folder+"/report.json")
const entry=report.solvers.find((s:any)=>s.name==="FanoutSolver")
if(!entry)throw Error("No fanout capture")
const args=readJson(folder+"/solver-"+entry.id+"-input.json.gz")
const [input,options]=args
const started=performance.now()
const solver=new FanoutSolver(input,options)
while(!solver.solved&&!solver.failed&&performance.now()-started<600000)solver.step()
const best=Reflect.get(solver,"bestAttempt")
if(!best)throw Error("No completed assignment")
const vias=best.plans.flatMap((p:any)=>getPlanVias(p))
const drc=validateRoutedCopperDrc({inputSrj:input,routedSrj:best.outputSrj,clearance:solver.config.clearance,allowBlindAndBuriedVias:solver.config.allowBlindAndBuriedVias})
let viaPadClearanceViolations=0,drillViolations=0
const drillGap=Math.max(input.minViaHoleEdgeToViaHoleEdgeClearance??0,input.minPlatedHoleDrillEdgeToDrillEdgeClearance??0)
for(const via of vias)for(const pad of input.obstacles)if(!pad.isCopperPour&&pad.layers.some((l:string)=>via.spanLayers.includes(l))&&distancePointToObstacle(via.center,pad)<via.diameter/2+solver.config.clearance-1e-9)viaPadClearanceViolations++
for(let i=0;i<vias.length;i++)for(let j=i+1;j<vias.length;j++)if(vias[i].spanLayers.some((l:string)=>vias[j].spanLayers.includes(l))&&distance(vias[i].center,vias[j].center)<(vias[i].holeDiameter+vias[j].holeDiameter)/2+drillGap-1e-9)drillViolations++
const summary={sample,mode,requested:input.connections.length,escapes:best.plans.length,signals:best.plans.filter((p:any)=>p.termination.type==='boundary').length,planes:best.plans.filter((p:any)=>p.termination.type==='plane').length,vias:vias.length,length:best.plans.reduce((s:number,p:any)=>s+p.length,0),solved:solver.solved,failed:solver.failed,assignments:solver.attempts.length,elapsedMs:performance.now()-started,drcValid:drc.valid,issues:drc.issues,viaPadClearanceViolations,drillViolations,inputSha256:new Bun.CryptoHasher('sha256').update(JSON.stringify(args)).digest('hex')}
mkdirSync('results');writeFileSync('results/summary.json',JSON.stringify(summary,null,2));writeFileSync('results/native.json.gz',gzipSync(JSON.stringify({summary,attempts:solver.attempts,best,preparedBuses:solver.preparedBuses,escapeLayersByBusId:Reflect.get(solver,'escapeLayersByBusId')})))
console.log('NATIVE_RESULT',JSON.stringify(summary))
if(!drc.valid||viaPadClearanceViolations||drillViolations)throw Error('Physical validation failed')
const failed=new Set(best.summary.failedBusIds)
const analysis=[]
for(const bus of solver.preparedBuses) {
 if(!failed.has(bus.busId))continue
 const rules={viaDiameter:solver.config.viaDiameter,viaHoleDiameter:solver.config.viaHoleDiameter,traceWidth:bus.traceWidth??solver.config.traceWidth,clearance:solver.config.clearance,additionalObstacles:input.obstacles}
 const sites=getComponentDogboneViaSiteCandidates([bus],rules)
 const layers=bus.termination.type==='plane'?[bus.termination.layer]:(bus.allowedLayers??solver.config.escapeLayers)
 const individual=layers.map((targetLayer:string)=>({layer:targetLayer,routed:routeBus({srj:input,bus,targetLayer,acceptedPlans:[],layerNames:solver.config.layerNames,...rules,compactBusTracks:solver.config.compactBusTracks,allowBlindAndBuriedVias:solver.config.allowBlindAndBuriedVias,allowSameNetMerges:solver.config.allowSameNetMerges})!==null}))
 analysis.push({bus:bus.busId,requests:bus.connections.length,direction:bus.direction,edge:bus.exitEdge,termination:bus.termination.type,traceWidth:rules.traceWidth,pitch:[bus.pitchX,bus.pitchY],sourcePoints:bus.connections.map((c:any)=>({index:c.connectionIndex,source:c.sourcePoint})),legalAdjacentSites:sites,individual,offeredLayers:Reflect.get(solver,'escapeLayersByBusId')[bus.busId]})
}
writeFileSync('results/failed-buses.json',JSON.stringify(analysis,null,2))
console.log('NATIVE_FAILURES',JSON.stringify(analysis.map(a=>({bus:a.bus,requests:a.requests,legalAdjacentSiteCount:a.legalAdjacentSites.length,layers:a.individual}))))
