type NodePoint={x:number;y:number;z:number}
type Owner={futureConnectionPoints?:NodePoint[];connectionName?:string}
type Row={id:number;connection:string;pointCount:number;counts:Record<string,number>;
  uniqueQueries:Set<string>;lastQuery:string;querySeen:boolean;tables:string[][]}
const ownerRows=new WeakMap<object,Row>(),rows:Row[]=[]
const sizes=[512,1024,2048,4096]
type GenericOwner={iterations:number;MAX_ITERATIONS:number;solved:boolean;failed:boolean;
  hasAttemptedToUseCache:boolean;cacheHit:boolean;connMap?:{netMap:Record<string,string[]>;idToNetMap:Record<string,string>}}
type GenericCapture={id:number;params:Record<string,unknown>;maxIterations:number;ownerIterations:number;
  hasAttemptedToUseCache:boolean;cacheHit:boolean;connectivityNetMap:Record<string,string[]>;
  connectivityIdToNetMap:Record<string,string>;owner:GenericOwner}
const genericConstructorParams=new WeakMap<object,Record<string,unknown>>()
const capturedGenericOwners=new WeakSet<object>(),genericCaptures:GenericCapture[]=[]

/** Diagnostic constructor capture retains the exact original argument only outside native state. */
export function captureGenericConstructor(owner:object,params:Record<string,unknown>):void {
  genericConstructorParams.set(owner,params)
  // The snapshot is deferred until the first original cache miss, after the
  // native supervisor has applied this candidate's real iteration cap.
  // No new owner field, method wrapper, cache decision or geometry write is made.
  // This isolated source-body diagnostic is never loaded by production.
}

export function captureGenericPostCacheMiss(owner:object):void {
  if(capturedGenericOwners.has(owner)) return
  const params=genericConstructorParams.get(owner),solver=owner as GenericOwner
  if(!params) throw new Error("Generic diagnostic lost the original constructor argument")
  const {connMap,cacheProvider,precomputedIntraNodeRouteParams,...geometry}=params
  const connectivity=solver.connMap
  if(!connectivity) throw new Error("Captured ordinary Generic candidate requires its canonical connectivity map")
  genericCaptures.push({id:genericCaptures.length,params:structuredClone(geometry),
    maxIterations:solver.MAX_ITERATIONS,ownerIterations:solver.iterations,
    hasAttemptedToUseCache:solver.hasAttemptedToUseCache,cacheHit:solver.cacheHit,
    connectivityNetMap:structuredClone(connectivity.netMap),
    connectivityIdToNetMap:structuredClone(connectivity.idToNetMap),owner:solver})
  capturedGenericOwners.add(owner)
}

function rowFor(owner:object):Row {
  let row=ownerRows.get(owner)
  if(!row) {
    const source=owner as Owner
    row={id:rows.length,connection:source.connectionName??"",pointCount:source.futureConnectionPoints?.length??0,
      counts:{},uniqueQueries:new Set(),lastQuery:"",querySeen:false,tables:sizes.map(()=>[])}
    ownerRows.set(owner,row);rows.push(row)
  }
  const points=(owner as Owner).futureConnectionPoints
  if(points) row.pointCount=points.length
  return row
}

/** Work-only counters never update a native owner, point, cache or policy. */
export function record(owner:object,name:string,count=1):void {
  const row=rowFor(owner)
  row.counts[name]=(row.counts[name]??0)+count
  // A source-body call preserves the solver method identities captured by the
  // existing deferred scalar memo. No method wrapper disables that fast path.
  // These counters establish operation counts, never elapsed-time evidence.
}

export function closestRequest(owner:object,node:NodePoint,key:number,viaDistance:number):void {
  const row=rowFor(owner),query=JSON.stringify([node.x,node.y,node.z,viaDistance])
  row.lastQuery=query;row.querySeen=row.uniqueQueries.has(query)
  row.uniqueQueries.add(query)
  row.counts.closestRequests=(row.counts.closestRequests??0)+1
  if(row.querySeen) row.counts.repeatedClosestRequests=(row.counts.repeatedClosestRequests??0)+1
  for(let index=0;index<sizes.length;index++) {
    const size=sizes[index]!,slot=Number.isSafeInteger(key)?Math.abs(key%size):-1
    const table=row.tables[index]!,name=`predictedDirect${size}Hits`
    if(slot>=0&&table[slot]===query) row.counts[name]=(row.counts[name]??0)+1
    if(slot>=0) table[slot]=query
  }
}

export function closestMiss(owner:object):void {
  const row=rowFor(owner)
  row.counts.closestMisses=(row.counts.closestMisses??0)+1
  if(row.querySeen) row.counts.repeatedClosestMisses=(row.counts.repeatedClosestMisses??0)+1
  // Predictions use the exact observed query sequence. They do not replace
  // or enlarge the original256-slot native selector cache during this census.
}

export function snapshot():object {
  const counts:Record<string,number>={},pointCounts:Record<string,number>={}
  for(const row of rows) {
    pointCounts[row.pointCount]=(pointCounts[row.pointCount]??0)+1
    for(const [name,count] of Object.entries(row.counts)) counts[name]=(counts[name]??0)+count
  }
  return {kind:"generic-hd-work-only-census",noTimingComparison:true,routeOwners:rows.length,
    counts,pointCounts,genericCandidates:genericCaptures.map(({owner,...capture})=>({...capture,
      finalIterations:owner.iterations,finalSolved:owner.solved,finalFailed:owner.failed})),
    owners:rows.map((row)=>({id:row.id,connection:row.connection,pointCount:row.pointCount,
      uniqueClosestQueries:row.uniqueQueries.size,counts:row.counts}))}
}
