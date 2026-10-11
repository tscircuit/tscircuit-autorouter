// Dormant Bun/Node functional prototype. Nothing in the production pipeline imports it.
import { types as utilTypes } from 'node:util'
import { buildHyperGraphWithRegionSelector } from './buildHyperGraphWithRegionSelector'
import { ConnectivityMap } from 'circuit-json-to-connectivity-map'
import { selectConnectionPointRegion } from 'lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/select-connection-point-region.ts'
import { checkIfConnectionPointIsInRegion } from 'lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/checkIfConnectionPointIsInRegion.ts'
import { getConnectionPointZLayers } from 'lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/get-connection-point-z-layers.ts'
import { hasIncidentPortOnConnectionPointLayer } from 'lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/has-incident-port-on-connection-point-layer.ts'
import type { HyperGraphHg, RegionHg } from 'lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/types.ts'
import { buildHyperGraph } from 'lib/solvers/PortPointPathingSolver/hgportpointpathingsolver/buildHyperGraph.ts'

type Params = Parameters<typeof buildHyperGraph>[0]
type Selector = typeof selectConnectionPointRegion
export type NativeEndpointRegionShortlistStats = { admitted:boolean; graphBuilds:number; queries:number; regionPredicateCalls:number; spatialRowTests:number; candidateRows:number; guardObjects:number; guardProperties:number; intrinsicObjects:number; intrinsicProperties:number }
type Contract = { object:object; parent:object|null; keys:PropertyKey[]; descriptors:PropertyDescriptor[] }
const getDescriptor=Object.getOwnPropertyDescriptor, getPrototype=Object.getPrototypeOf, ownKeys=Reflect.ownKeys, same=Object.is, own=Object.hasOwn
const apply=Reflect.apply, functionSource=Function.prototype.toString, proxy=utilTypes.isProxy, array=Array.isArray, finite=Number.isFinite
const globals=['Object','Array','Math','Number','String','Set','Map','WeakSet','WeakMap','Symbol','Function','Reflect','parseInt']
const globalDescriptors=globals.map((name)=>getDescriptor(globalThis,name)!)
const objects=[Object.prototype,Object,Array,Array.prototype,Math,Number,Number.prototype,String,String.prototype,Set,Set.prototype,Map,Map.prototype,WeakSet,WeakSet.prototype,WeakMap,WeakMap.prototype,Symbol,Symbol.prototype,Function,Function.prototype,Reflect,ConnectivityMap.prototype,
  getPrototype([][Symbol.iterator]()),getPrototype(getPrototype([][Symbol.iterator]())),getPrototype(new Set()[Symbol.iterator]())]
const contracts=objects.map((object):Contract=>{const keys=ownKeys(object);return{object,parent:getPrototype(object),keys,descriptors:keys.map((key)=>getDescriptor(object,key)!)}})
const nativeChecks=[getDescriptor,getPrototype,ownKeys,same,own,apply,functionSource,proxy,array,finite,Math.abs,Math.min,Math.max,Math.sqrt,Array.prototype.sort,Array.prototype.push,Array.prototype.pop,WeakSet.prototype.has,WeakSet.prototype.add,WeakMap.prototype.has,WeakMap.prototype.get,WeakMap.prototype.set,parseInt]
  .map((value)=>apply(functionSource,value,[]).includes('[native code]'))
const epsilon=Number.EPSILON, tolerance=1e-3

function descriptorMatches(a:PropertyDescriptor|undefined,b:PropertyDescriptor):boolean {
  if(!a)return false
  for(const key of ['value','get','set','writable','enumerable','configurable'] as const){
    const ah=own(a,key),bh=own(b,key)
    if(ah!==bh || (ah&&!same(a[key],b[key])))return false
  }
  return true
}

function nativeContract(stats:NativeEndpointRegionShortlistStats):boolean {
  for(let index=0;index<nativeChecks.length;index++)if(!nativeChecks[index])return false
  for(let index=0;index<contracts.length;index++){
    const contract=contracts[index]!
    stats.intrinsicObjects++
    if(getPrototype(contract.object)!==contract.parent)return false
    const keys=ownKeys(contract.object)
    if(keys.length!==contract.keys.length)return false
    for(let key=0;key<keys.length;key++){stats.intrinsicProperties++;if(keys[key]!==contract.keys[key]||!descriptorMatches(getDescriptor(contract.object,keys[key]!),contract.descriptors[key]!))return false}
  }
  for(let index=0;index<globals.length;index++){stats.intrinsicProperties++;if(!descriptorMatches(getDescriptor(globalThis,globals[index]!),globalDescriptors[index]!))return false}
  return true
}

function plainEndpointSpan(params:Params,graph:HyperGraphHg,stats:NativeEndpointRegionShortlistStats):{root:Row|null;candidatesByPoint:WeakMap<object,Row[]>}|undefined {
  const record=(value:unknown):value is Record<PropertyKey,any>=>{
    if(typeof value!=='object'||value===null||proxy(value))return false
    const parent=getPrototype(value)
    if(parent!==Object.prototype&&parent!==null)return false
    stats.guardObjects++;return true
  }
  const field=(value:object,key:PropertyKey):{ok:boolean;value:any}=>{
    stats.guardProperties++
    const descriptor=getDescriptor(value,key)
    return !descriptor?{ok:true,value:undefined}:own(descriptor,'value')?{ok:true,value:descriptor.value}:{ok:false,value:undefined}
  }
  const visitedArrays=new WeakSet<object>()
  const dataArray=(value:unknown):value is any[]=>{
    if(typeof value!=='object'||value===null||proxy(value)||getPrototype(value)!==Array.prototype||!array(value))return false
    if(visitedArrays.has(value))return true
    visitedArrays.add(value);stats.guardObjects++
    for(const method of ['some','includes','map','constructor',Symbol.iterator])if(getDescriptor(value,method))return false
    for(let index=0;index<value.length;index++){const item=field(value,index);if(!item.ok||!own(value,index))return false}
    return true
  }
  if(!record(params))return undefined
  const mapField=field(params,'connectivityMap'),connections=field(params,'simpleRouteJsonConnections'),layerCount=field(params,'layerCount')
  if(!mapField.ok||!connections.ok||!layerCount.ok||!finite(layerCount.value))return undefined
  const map=mapField.value
  if(typeof map!=='object'||map===null||proxy(map)||getPrototype(map)!==ConnectivityMap.prototype||getDescriptor(map,'getNetConnectedToId'))return undefined
  stats.guardObjects++
  const idMap=field(map,'idToNetMap')
  if(!idMap.ok||!record(idMap.value))return undefined
  for(const key of ownKeys(idMap.value))if(!field(idMap.value,key).ok)return undefined
  if(!dataArray(connections.value))return undefined
  const endpoints:object[]=[]
  for(const connection of connections.value){
    if(!record(connection))return undefined
    const name=field(connection,'name'),points=field(connection,'pointsToConnect')
    if(!name.ok||typeof name.value!=='string'||!points.ok||!dataArray(points.value)||points.value.length<2)return undefined
    for(let point=0;point<2;point++){
      const p=points.value[point]
      if(!record(p))return undefined
      const x=field(p,'x'),y=field(p,'y'),layer=field(p,'layer'),layers=field(p,'layers')
      if(!x.ok||!y.ok||!finite(x.value)||!finite(y.value)||!layer.ok||!layers.ok)return undefined
      if(getDescriptor(p,'layer')){if(typeof layer.value!=='string'||getDescriptor(p,'layers'))return undefined}
      else{if(!dataArray(layers.value))return undefined;for(const z of layers.value)if(typeof z!=='string')return undefined}
      endpoints.push(p)
    }
  }
  if(!record(graph))return undefined
  const regions=field(graph,'regions')
  if(!regions.ok||!dataArray(regions.value))return undefined
  const regionSet=new Set<object>(regions.value)
  for(const region of regions.value){
    if(!record(region))return undefined
    const data=field(region,'d')
    if(!data.ok||!record(data.value))return undefined
    const center=field(data.value,'center'),width=field(data.value,'width'),height=field(data.value,'height')
    if(!center.ok||!record(center.value)||!width.ok||!height.ok||!finite(width.value)||!finite(height.value)||width.value<0||height.value<0)return undefined
    const x=field(center.value,'x'),y=field(center.value,'y')
    if(!x.ok||!y.ok||!finite(x.value)||!finite(y.value))return undefined
    const bounds=[x.value-width.value/2,x.value+width.value/2,y.value-height.value/2,y.value+height.value/2]
    for(const bound of bounds)if(!finite(bound)||!finite(paddedLower(bound))||!finite(paddedUpper(bound)))return undefined
  }
  const root=buildIndex(graph),candidatesByPoint=new WeakMap<object,Row[]>(),candidateRegions=new Set<RegionHg>()
  for(const point of endpoints){
    if(candidatesByPoint.has(point))continue
    const p=point as {x:number;y:number},rows=getCandidates(root,p.x,p.y,stats)
    candidatesByPoint.set(point,rows)
    for(const row of rows)candidateRegions.add(row.region)
  }
  const validatedLayers=new WeakSet<object>(),seenPorts=new WeakSet<object>()
  const validateLayers=(region:RegionHg):boolean=>{
    if(validatedLayers.has(region))return true
    const available=field(region.d,'availableZ')
    if(!available.ok||!dataArray(available.value))return false
    for(const z of available.value)if(typeof z!=='number'||!finite(z))return false
    validatedLayers.add(region);return true
  }
  for(const region of candidateRegions){
    if(!validateLayers(region))return undefined
    const ports=field(region,'ports')
    if(!ports.ok||!dataArray(ports.value))return undefined
    for(const port of ports.value){
      if(typeof port!=='object'||port===null||proxy(port))return undefined
      if(seenPorts.has(port))continue
      seenPorts.add(port)
      if(!record(port))return undefined
      const d=field(port,'d'),r1=field(port,'region1'),r2=field(port,'region2')
      if(!d.ok||!record(d.value)||!r1.ok||!r2.ok||!regionSet.has(r1.value)||!regionSet.has(r2.value)||!validateLayers(r1.value)||!validateLayers(r2.value))return undefined
      const z=field(d.value,'z')
      if(!z.ok||typeof z.value!=='number'||!finite(z.value))return undefined
    }
  }
  return{root,candidatesByPoint}
}

type Row={ordinal:number;minX:number;maxX:number;minY:number;maxY:number;subtreeMaxX:number;region:RegionHg;left:Row|null;right:Row|null}
function paddedLower(value:number):number{return value-tolerance*(1+1e-12)-Math.abs(value)*epsilon*8}
function paddedUpper(value:number):number{return value+tolerance*(1+1e-12)+Math.abs(value)*epsilon*8}
function buildIndex(graph:HyperGraphHg):Row|null {
  const rows:Row[]=graph.regions.map((region,ordinal)=>{const d=region.d;return{ordinal,region,minX:paddedLower(d.center.x-d.width/2),maxX:paddedUpper(d.center.x+d.width/2),minY:paddedLower(d.center.y-d.height/2),maxY:paddedUpper(d.center.y+d.height/2),subtreeMaxX:0,left:null,right:null}})
  rows.sort((a,b)=>a.minX-b.minX||a.ordinal-b.ordinal)
  const build=(from:number,to:number):Row|null=>{
    if(from===to)return null
    const mid=(from+to)>>>1,node=rows[mid]!
    node.left=build(from,mid);node.right=build(mid+1,to)
    node.subtreeMaxX=Math.max(node.maxX,node.left?.subtreeMaxX??-Infinity,node.right?.subtreeMaxX??-Infinity)
    return node
  }
  return build(0,rows.length)
}

function getCandidates(root:Row|null,x:number,y:number,stats:NativeEndpointRegionShortlistStats):Row[] {
  const candidates:Row[]=[]
  const visit=(row:Row|null):void=>{
    if(!row||row.subtreeMaxX<x)return
    stats.spatialRowTests++
    visit(row.left)
    if(row.minX>x)return
    if(row.maxX>=x&&row.minY<=y&&row.maxY>=y)candidates.push(row)
    visit(row.right)
  }
  visit(root);candidates.sort((a,b)=>a.ordinal-b.ordinal)
  return candidates
}

/** Private selector: its only supported lifetime is a synchronous source-exact build. */
function createPrototypeEndpointSelector(params:Params):{select:Selector;stats:NativeEndpointRegionShortlistStats;finish:()=>void} {
  const stats:NativeEndpointRegionShortlistStats={admitted:false,graphBuilds:0,queries:0,regionPredicateCalls:0,spatialRowTests:0,candidateRows:0,guardObjects:0,guardProperties:0,intrinsicObjects:0,intrinsicProperties:0}
  if(!nativeContract(stats))return{select:selectConnectionPointRegion,stats,finish:()=>{}}
  let mode:'pending'|'native'|'active'='pending'
  let graph:HyperGraphHg|undefined,root:Row|null=null,finished=false,candidatesByPoint:WeakMap<object,Row[]>|undefined
  const select:Selector=(query)=>{
    if(finished)throw new Error('Endpoint selector used outside synchronous native build')
    if(mode==='pending'){
      if(!nativeContract(stats)){mode='native';return selectConnectionPointRegion(query)}
      const prepared=plainEndpointSpan(params,query.graph,stats)
      if(!prepared){mode='native';return selectConnectionPointRegion(query)}
      mode='active';stats.admitted=true;graph=query.graph;root=prepared.root;candidatesByPoint=prepared.candidatesByPoint;stats.graphBuilds++
    }
    if(mode==='native')return selectConnectionPointRegion(query)
    const pointZLayers=getConnectionPointZLayers({point:query.point,layerCount:query.layerCount})
    if(graph!==query.graph)throw new Error('Endpoint selector received another graph')
    stats.queries++
    const candidates=candidatesByPoint!.get(query.point)
    if(!candidates)throw new Error('Endpoint selector received an unvalidated point')
    stats.candidateRows+=candidates.length
    let first:RegionHg|undefined
    for(const row of candidates){
      stats.regionPredicateCalls++
      const region=row.region
      if(!checkIfConnectionPointIsInRegion({...query,region,pointZLayers}))continue
      first??=region
      if(hasIncidentPortOnConnectionPointLayer({region,pointZLayers}))return region
    }
    return first
  }
  return{select,stats,finish:()=>{finished=true;graph=undefined;root=null}}
}


/** Uses the source-exact native builder, original query order, and a private whole-build index. */
export function buildNativeHyperGraphWithEndpointShortlist(params: Params): {
  output: ReturnType<typeof buildHyperGraph>
  stats: NativeEndpointRegionShortlistStats
} {
  const span = createPrototypeEndpointSelector(params)
  try {
    return { output: buildHyperGraphWithRegionSelector(params, span.select), stats: span.stats }
  } finally {
    span.finish()
  }
}

/** Numeric selection oracle only; no index or callable selector escapes this synchronous span. */
export function selectNativeEndpointRegionsForProof(params: Params, graph: HyperGraphHg): {
  regions: Array<RegionHg | undefined>
  stats: NativeEndpointRegionShortlistStats
} {
  const span = createPrototypeEndpointSelector(params)
  try {
    const regions: Array<RegionHg | undefined> = []
    for (const connection of params.simpleRouteJsonConnections) {
      for (const point of connection.pointsToConnect.slice(0, 2)) {
        regions.push(span.select({ graph, point, layerCount: params.layerCount }))
      }
    }
    return { regions, stats: span.stats }
  } finally {
    span.finish()
  }
}
