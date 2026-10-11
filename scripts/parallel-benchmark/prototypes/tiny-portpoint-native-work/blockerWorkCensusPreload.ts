import {plugin} from 'bun'
import {readFileSync, appendFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
const sourceCopies: Array<{path:string;originalSha256:string;copySha256:string}>=[]
function recordCopy(path:string,original:string,copy:string):void {
 const row={path,originalSha256:createHash('sha256').update(original).digest('hex'),copySha256:createHash('sha256').update(copy).digest('hex')}
 sourceCopies.push(row)
 if(process.env.PATHING_CENSUS_TRANSFORMS)appendFileSync(process.env.PATHING_CENSUS_TRANSFORMS,JSON.stringify(row)+'\n')
}
export function getIsolatedSourceCopies():typeof sourceCopies {return sourceCopies.map((row):typeof row=>({...row}))}
function one(s:string,a:string,b:string):string{if(s.split(a).length!==2)throw new Error('missing seam '+a);return s.replace(a,b)}
plugin({name:'isolated-native-blocker-work-census',setup(build){
 build.onLoad({filter:/SelectiveReripTinyHyperGraphSolver\.ts$/},args=>{
  if(!args.path.includes('tiny-hypergraph-fork/'))return undefined
  const original=readFileSync(args.path,'utf8');let s=original
  s=one(s,'    const hopsByState = new Map<number, RelaxedSearchHop[]>()',`    const hopsByState = new Map<number, RelaxedSearchHop[]>()
    const census = newIsolatedBlockerSearch(this, routeId, routeNetId, goalPortId, forbiddenOwnerRouteIds)`)
  s=one(s,'        if (cached) return cached','        if (cached) { census.cacheHits++; census.returnedHops += cached.length; return cached }')
  s=one(s,'        hopsByState.set(key, hops)','        census.cacheMisses++; census.builtHops += hops.length; census.returnedHops += hops.length\n        hopsByState.set(key, hops)')
  s=one(s,'distance: Math.hypot(\n            this.topology.portX[state.portId]!', 'distance: (recordIsolatedBlockerDistance(this, state.portId, template.state.portId), Math.hypot(\n            this.topology.portX[state.portId]!')
  s=one(s,'this.topology.portY[template.state.portId]!,\n          ),','this.topology.portY[template.state.portId]!,\n          )),')
  s=one(s,'distance: Math.hypot(\n          this.topology.portX[state.portId]!', 'distance: (recordIsolatedBlockerDistance(this, state.portId, neighborPortId), Math.hypot(\n          this.topology.portX[state.portId]!')
  s=one(s,'this.topology.portY[neighborPortId]!,\n        ),','this.topology.portY[neighborPortId]!,\n        )),')
  s=one(s,'    const first = this.populateSegmentGeometryScratch(\n      regionId,', '    recordIsolatedBlockerCrossing(this, regionId, firstFromPortId, firstToPortId, secondFromPortId, secondToPortId)\n    const first = this.populateSegmentGeometryScratch(\n      regionId,')
  s+=String.raw`
const isolatedBlockerOwners = new Map<object, any>()
function isolatedBlockerOwner(owner:any):any {
 let c=isolatedBlockerOwners.get(owner)
 if(!c){c={name:owner.constructor.name,portCount:owner.topology.portCount,searches:[],distanceCalls:0,distancePairs:new Set(),crossingCalls:0,crossings:new Set()};isolatedBlockerOwners.set(owner,c)}
 return c
}
function newIsolatedBlockerSearch(owner:any,routeId:number,routeNetId:number,goalPortId:number,forbidden:ReadonlySet<number>):any {
 const c=isolatedBlockerOwner(owner),r={routeId,routeNetId,goalPortId,forbidden:[...forbidden],cacheHits:0,cacheMisses:0,builtHops:0,returnedHops:0}
 c.searches.push(r);return r
}
function recordIsolatedBlockerDistance(owner:any,from:number,to:number):void {const c=isolatedBlockerOwner(owner);c.distanceCalls++;c.distancePairs.add(from*c.portCount+to)}
function recordIsolatedBlockerCrossing(owner:any,region:number,a:number,b:number,c1:number,d:number):void {const c=isolatedBlockerOwner(owner);c.crossingCalls++;c.crossings.add(region+':'+a+':'+b+':'+c1+':'+d)}
export function getIsolatedBlockerGeometryCensus():any[] {return [...isolatedBlockerOwners.values()].map(c=>({name:c.name,searches:c.searches,distanceCalls:c.distanceCalls,directedDistancePairs:c.distancePairs.size,crossingCalls:c.crossingCalls,directedCrossingQueries:c.crossings.size}))}
`
  recordCopy(args.path,original,s)
  return {contents:s,loader:'ts'}
 })
 build.onLoad({filter:/findPackedDistinctOwnerBlockerPath\.ts$/},args=>{
  const original=readFileSync(args.path,'utf8');let s=original
  s=one(s,'    for (const hop of options.getHops(state)) {',`    const censusHops = options.getHops(state)
    recordIsolatedBlockerHops(options, state, censusHops, 'reachability')
    for (const hop of censusHops) {`)
  s=one(s,'    for (const hop of options.getHops(states[current]!)) {',`    const censusHops = options.getHops(states[current]!)
    recordIsolatedBlockerHops(options, states[current]!, censusHops, 'labels')
    for (const hop of censusHops) {`)
  s=one(s,'  const limit = options.maxExpandedLabels ?? Number.POSITIVE_INFINITY','  const census = isolatedBlockerCall(options)\n  const limit = options.maxExpandedLabels ?? Number.POSITIVE_INFINITY')
  s=one(s,'    const countDifference = labelOwnerCounts[left]! - labelOwnerCounts[right]!','    census.heapComparisons++\n    const countDifference = labelOwnerCounts[left]! - labelOwnerCounts[right]!')
  s=one(s,'    if (subsetId === existingId) return true','    census.subsetUnionCalls++\n    if (subsetId === existingId) {census.sameRowUnion++;return true}')
  s=one(s,'    if (subsetId === supersetId) return true','    census.subsetRowCalls++\n    if (subsetId === supersetId) {census.sameRowSubset++;return true}')
  s=one(s,'      const order = nextOrder++','      const order = nextOrder++;census.proposals++')
  s=one(s,'      if (dominated) continue','      if (dominated) {census.dominated++;continue}')
  s=one(s,'      const candidate = states.length','      census.accepted++\n      const candidate = states.length')
  s=one(s,'        ownerRows.push(row)','        census.ownerRowCopies++\n        ownerRows.push(row)')
  s+=String.raw`
const isolatedBlockerCalls=new Map<object,any>()
function isolatedBlockerCall(options:any):any {let c=isolatedBlockerCalls.get(options);if(!c){c={ownerCount:options.ownerCount,limit:options.maxExpandedLabels,rows:new Map(),reachabilityCalls:0,labelCalls:0,reachabilityHops:0,labelHops:0,heapComparisons:0,subsetUnionCalls:0,subsetRowCalls:0,sameRowUnion:0,sameRowSubset:0,proposals:0,dominated:0,accepted:0,ownerRowCopies:0};isolatedBlockerCalls.set(options,c)}return c}
function recordIsolatedBlockerHops(options:any,state:any,hops:any[],phase:string):void {const c=isolatedBlockerCall(options),key=options.getStateKey(state);let row=c.rows.get(key);if(!row){row={calls:0,hops:hops.length};c.rows.set(key,row)}row.calls++;if(phase==='reachability'){c.reachabilityCalls++;c.reachabilityHops+=hops.length}else{c.labelCalls++;c.labelHops+=hops.length}}
export function getIsolatedBlockerLabelCensus():any[] {return [...isolatedBlockerCalls.values()].map(({rows,...c})=>({...c,uniqueStates:rows.size,uniqueHops:[...rows.values()].reduce((s:number,r:any)=>s+r.hops,0),maxVisitsToOneState:Math.max(0,...[...rows.values()].map((r:any)=>r.calls))}))}
`
  recordCopy(args.path,original,s)
  return {contents:s,loader:'ts'}
 })
}})
