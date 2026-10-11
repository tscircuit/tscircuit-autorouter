import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { loadScenarioBySampleNumber } from 'scripts/benchmark/scenarios.ts'
import { AutoroutingPipelineSolver9_PreloadedTraceGraph } from 'lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/AutoroutingPipelineSolver9_PreloadedTraceGraph.ts'
import { buildHyperGraph } from 'lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/buildHyperGraph.ts'
import { checkIfConnectionPointIsInRegion } from 'lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/checkIfConnectionPointIsInRegion'
import { getConnectionPointZLayers } from 'lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/get-connection-point-z-layers'
import { hasIncidentPortOnConnectionPointLayer } from 'lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/has-incident-port-on-connection-point-layer'
import { selectConnectionPointRegion } from 'lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/select-connection-point-region.ts'
import { ConnectivityMap } from 'circuit-json-to-connectivity-map'
import { buildNativeHyperGraphWithEndpointShortlist, selectNativeEndpointRegionsForProof } from 'scripts/parallel-benchmark/prototypes/native-endpoint-region/buildNativeHyperGraphWithEndpointShortlist'

export async function collectNativeEndpointRegionShortlistProof(): Promise<any> {
const proof:any={kind:'Functional/call-work proof only; no elapsed times',sampleRows:[],randomCases:0,observerCases:[],sourceCopy:true}
const original=await readFile(new URL('../../../lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/buildHyperGraph.ts', import.meta.url),'utf8')
const copied=await readFile(new URL('../../../scripts/parallel-benchmark/prototypes/native-endpoint-region/buildHyperGraphWithRegionSelector.ts', import.meta.url),'utf8')
const expected=original.replace(/from "\.\//g,'from "lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/').replace('export function buildHyperGraph(params:','export function buildHyperGraphWithRegionSelector(params:').replace('}): {\n  graph:','}, regionSelector: typeof selectConnectionPointRegion = selectConnectionPointRegion): {\n  graph:').replace('const startRegion = selectConnectionPointRegion({','const startRegion = regionSelector({').replace('const endRegion = selectConnectionPointRegion({','const endRegion = regionSelector({')
assert.equal(copied,expected)
function canonicalOutput(output:ReturnType<typeof buildHyperGraph>):unknown {
  const portOrdinals=new Map(output.graph.ports.map((port,index)=>[port,index]))
  const regionOrdinals=new Map(output.graph.regions.map((region,index)=>[region,index]))
  return{
    regions:output.graph.regions.map((region)=>({regionId:region.regionId,d:region.d,ports:region.ports.map((port)=>portOrdinals.get(port))})),
    ports:output.graph.ports.map((port)=>{const{regions,...d}=port.d;return{portId:port.portId,d,regions:regions.map((region)=>regionOrdinals.get(region)),region1:regionOrdinals.get(port.region1),region2:regionOrdinals.get(port.region2)}}),
    connections:output.connections.map((connection)=>({...connection,startRegion:regionOrdinals.get(connection.startRegion),endRegion:regionOrdinals.get(connection.endRegion)})),
  }
}
function countNativeEndpointPredicates(params: Parameters<typeof buildHyperGraph>[0], graph: ReturnType<typeof buildHyperGraph>["graph"]): number {
  let count = 0
  for (const connection of params.simpleRouteJsonConnections) {
    for (const point of connection.pointsToConnect.slice(0, 2)) {
      const pointZLayers = getConnectionPointZLayers({ point, layerCount: params.layerCount })
      for (const region of graph.regions) {
        count++
        if (!checkIfConnectionPointIsInRegion({ point, region, layerCount: params.layerCount, pointZLayers })) continue
        if (hasIncidentPortOnConnectionPointLayer({ region, pointZLayers })) break
      }
    }
  }
  return count
}
for(const sample of Array.from({length:16},(_,i)=>i+1)){
  const{scenario}=await loadScenarioBySampleNumber('srj18',sample,1)
  const pipeline=new AutoroutingPipelineSolver9_PreloadedTraceGraph(structuredClone(scenario),{effort:1,cacheProvider:null})
  while(pipeline.pipelineDef[pipeline.currentPipelineStepIndex]?.solverName!=='portPointPathingSolver'){pipeline.step();assert.equal(pipeline.failed,false,pipeline.error??'')}
  const srj=pipeline.srjWithPointPairs!
  const params={capacityMeshNodes:pipeline.capacityNodes!,layerCount:pipeline.srj.layerCount,connectivityMap:pipeline.connMap,segmentPortPoints:pipeline.sharedEdgeSegmentsWithNecessaryCrampedPortPoints!.flatMap(x=>x.portPoints),simpleRouteJsonConnections:srj.connections}
  const native=buildHyperGraph(params), result=buildNativeHyperGraphWithEndpointShortlist(params), candidate=result.output
  assert.equal(result.stats.admitted,true)
  assert.deepEqual(canonicalOutput(candidate),canonicalOutput(native))
  assert.equal(result.stats.queries,params.simpleRouteJsonConnections.length*2)
  assert.equal(result.stats.graphBuilds,1)
  assert.equal(pipeline.portPointPathingSolver,undefined)
  const row={sample,regions:native.graph.regions.length,ports:native.graph.ports.length,connections:native.connections.length,...result.stats,nativeRegionPredicateCalls:countNativeEndpointPredicates(params,native.graph),originalTinySearchCalls:0,candidateTinySearchCalls:0}
  proof.sampleRows.push(row)

}
let randomState=0x651221
const random=()=>{randomState=(Math.imul(randomState,1664525)+1013904223)>>>0;return randomState/2**32}
for(let test=0;test<1000;test++){
  const nodes=Array.from({length:1+Math.floor(random()*60)},(_,i)=>({capacityMeshNodeId:'n'+i,center:{x:random()*80-40,y:random()*80-40},width:random()*50,height:random()*50,availableZ:[i%2],layer:i%2?'bottom':'top',_containsObstacle:false}))
  const c={name:'c',pointsToConnect:[{x:0,y:0,layer:'top'},{x:1,y:1,layer:'bottom'}]}
  const params:any={capacityMeshNodes:nodes,simpleRouteJsonConnections:[c],segmentPortPoints:[],layerCount:2,connectivityMap:new ConnectivityMap({net:['c']})}
  const regions:any[]=nodes.map((d,i)=>({regionId:d.capacityMeshNodeId,d,ports:[]}))
  for(let i=0;i<regions.length;i++)if(i%3===0){const port:any={d:{z:i%2},region1:regions[i],region2:regions[(i+1)%regions.length]};regions[i].ports.push(port)}
  const graph:any={regions,ports:[]}
  const queries:any[]=[]
  for(let point=0;point<20;point++){
    const node=nodes[Math.floor(random()*nodes.length)]!
    const query:any={graph,layerCount:2,point:{x:point%2?node.center.x+node.width/2+[0,1e-3,1e-3*(1-Number.EPSILON),1e-3*(1+Number.EPSILON),-0][point%5]!:random()*100-50,y:node.center.y,layer:point%3?'top':'bottom'}}
    queries.push(query)
  }
  params.simpleRouteJsonConnections=Array.from({length:10},(_,i)=>({name:'c'+i,pointsToConnect:[queries[i*2].point,queries[i*2+1].point]}))
  const result=selectNativeEndpointRegionsForProof(params,graph)
  for(let i=0;i<queries.length;i++){
    assert.equal(result.regions[i],selectConnectionPointRegion(queries[i]));proof.randomCases++
  }
  assert.equal(result.stats.admitted,true)
}

const scales=[-1e308,-1e300,-1e100,-1e20,-4096,-1,-1e-3,-1e-20,-1e-300,-Number.MIN_VALUE,-0,0,Number.MIN_VALUE,1e-300,1e-20,1e-3,1,4096,1e20,1e100,1e300,1e308]
proof.ieeeBoundaryCases=0
for(const scale of scales)for(const width of [0,Number.MIN_VALUE,1e-300,1e-3,1,1e20]){
  const node:any={capacityMeshNodeId:'boundary',center:{x:scale,y:scale},width,height:width,availableZ:[0,1],layer:'top'}
  const points:any[]=Array.from({length:20},(_,i)=>({x:scale+width/2+[0,1e-3,1e-3*(1-Number.EPSILON),1e-3*(1+Number.EPSILON),-1e-3][i%5]!,y:scale+(i%2?width/2:0),layer:i%3?'top':'bottom'}))
  const params:any={capacityMeshNodes:[node],simpleRouteJsonConnections:Array.from({length:10},(_,i)=>({name:'c',pointsToConnect:[points[i*2],points[i*2+1]]})),segmentPortPoints:[],layerCount:2,connectivityMap:new ConnectivityMap({net:['c']})}
  const graph:any={regions:[{regionId:'boundary',d:node,ports:[]}],ports:[]}
  const result=selectNativeEndpointRegionsForProof(params,graph)
  for(let i=0;i<points.length;i++){const q={graph,layerCount:2,point:points[i]};assert.equal(result.regions[i],selectConnectionPointRegion(q));proof.ieeeBoundaryCases++}
}

function observerFixture(kind:string,events:string[]):any {
  const nodes:any[]=[{capacityMeshNodeId:'n',center:{x:0,y:0},width:10,height:10,availableZ:[0,1],layer:'top'}]
  const c:any={name:'c',pointsToConnect:[{x:0,y:0,layer:'top'},{x:1,y:1,layer:'bottom'}]}
  const params:any={capacityMeshNodes:nodes,simpleRouteJsonConnections:[c],segmentPortPoints:[],layerCount:2,connectivityMap:new ConnectivityMap({net:['c']})}
  if(kind==='point-getter')Object.defineProperty(c.pointsToConnect[0],'x',{get(){events.push('point.x');return 0},enumerable:true,configurable:true})
  if(kind==='node-getter')Object.defineProperty(nodes[0],'width',{get(){events.push('node.width');return 10},enumerable:true,configurable:true})
  if(kind==='connection-points-getter')Object.defineProperty(c,'pointsToConnect',{get(){events.push('connection.points');return[{x:0,y:0,layer:'top'},{x:1,y:1,layer:'bottom'}]},enumerable:true,configurable:true})
  if(kind==='node-proxy')nodes[0]=new Proxy(nodes[0],{get(target,key,receiver){events.push('node.'+String(key));return Reflect.get(target,key,receiver)},getOwnPropertyDescriptor(){throw new Error('proxy descriptor must not be read')}})
  if(kind==='connmap-query'){const fn=params.connectivityMap.getNetConnectedToId;params.connectivityMap.getNetConnectedToId=function(id:string){events.push('map.'+id);return fn.call(this,id)}}
  if(kind==='query-error'){params.connectivityMap.getNetConnectedToId=function(id:string){events.push('map.'+id);throw new Error('original query error')}}
  if(kind==='invalid-layer')c.pointsToConnect[1]={x:1,y:1,layer:42}
  if(kind==='missing-net')params.connectivityMap=new ConnectivityMap({})
  if(kind==='invalid-geometry')nodes[0].width=NaN
  if(kind==='undefined-layer-presence')c.pointsToConnect[1]={x:1,y:1,layer:undefined,layers:['top']}
  if(kind==='bootstrap-point-mutation')Object.defineProperty(nodes[0],'_connectedTo',{get(){events.push('original-bootstrap');c.pointsToConnect[1].x=2;return undefined},enumerable:true,configurable:true})
  if(kind==='bootstrap-future-getter')Object.defineProperty(nodes[0],'_connectedTo',{get(){events.push('original-bootstrap');Object.defineProperty(c.pointsToConnect[1],'x',{get(){events.push('future.x');return 2},enumerable:true,configurable:true});return undefined},enumerable:true,configurable:true})
  return params
}
function runObserver(params:any,candidate:boolean):any {
  try{const result=candidate?buildNativeHyperGraphWithEndpointShortlist(params):undefined;const output=result?.output??buildHyperGraph(params);return{output:{regions:output.graph.regions.map((r)=>r.regionId),connections:output.connections.map((c)=>[c.connectionId,c.mutuallyConnectedNetworkId,c.startRegion.regionId,c.endRegion.regionId])},admitted:result?.stats.admitted}}
  catch(error){return{error:error instanceof Error?[error.name,error.message]:error,admitted:false}}
}
for(const kind of ['point-getter','node-getter','connection-points-getter','node-proxy','connmap-query','query-error','invalid-layer','missing-net','invalid-geometry','undefined-layer-presence','bootstrap-point-mutation','bootstrap-future-getter']){
  const nativeEvents:string[]=[],candidateEvents:string[]=[]
  const native=runObserver(observerFixture(kind,nativeEvents),false),candidate=runObserver(observerFixture(kind,candidateEvents),true)
  assert.deepEqual(candidate.error,native.error,kind)
  assert.deepEqual(candidate.output,native.output,kind)
  assert.deepEqual(candidateEvents,nativeEvents,kind)
  if(kind!=='invalid-layer'&&kind!=='missing-net'&&kind!=='bootstrap-point-mutation')assert.equal(candidate.admitted,false,kind)
  proof.observerCases.push({kind,admitted:candidate.admitted,originalEvents:nativeEvents,candidateEvents,error:native.error})
}
for(const key of ['sqrt','abs']){
  const descriptor=Object.getOwnPropertyDescriptor(Math,key)!,nativeEvents:string[]=[],candidateEvents:string[]=[]
  let events=nativeEvents
  try{
    Object.defineProperty(Math,key,{configurable:true,enumerable:descriptor.enumerable,get(){events.push('Math.'+key);return descriptor.value}})
    const native=runObserver(observerFixture('default',nativeEvents),false)
    events=candidateEvents
    const candidate=runObserver(observerFixture('default',candidateEvents),true)
    assert.equal(candidate.admitted,false)
    assert.deepEqual(candidate.output,native.output)
    assert.deepEqual(candidateEvents,nativeEvents)
    proof.observerCases.push({kind:'Math.'+key+'-getter',admitted:false,originalEvents:nativeEvents,candidateEvents})
  }finally{Object.defineProperty(Math,key,descriptor)}
}
for (const key of ["get", "set", "has"] as const) {
  const descriptor = Object.getOwnPropertyDescriptor(WeakMap.prototype, key)!
  const nativeEvents: string[] = [], candidateEvents: string[] = []
  let events = nativeEvents
  try {
    Object.defineProperty(WeakMap.prototype, key, { ...descriptor, value: function(this: WeakMap<object, unknown>, ...args: unknown[]): unknown { events.push("WeakMap." + key); return Reflect.apply(descriptor.value, this, args) } })
    const native = runObserver(observerFixture("default", nativeEvents), false)
    events = candidateEvents
    const candidate = runObserver(observerFixture("default", candidateEvents), true)
    assert.equal(candidate.admitted, false)
    assert.deepEqual(candidate.output, native.output)
    assert.deepEqual(candidateEvents, nativeEvents)
    proof.observerCases.push({kind:"WeakMap."+key+"-wrapper", admitted:false, originalEvents:nativeEvents, candidateEvents})
  } finally { Object.defineProperty(WeakMap.prototype, key, descriptor) }
}
proof.totals=Object.fromEntries(['nativeRegionPredicateCalls','queries','regionPredicateCalls','spatialRowTests','candidateRows','guardObjects','guardProperties','intrinsicObjects','intrinsicProperties'].map((key)=>[key,proof.sampleRows.reduce((n:number,x:any)=>n+x[key],0)]))
return proof
}
