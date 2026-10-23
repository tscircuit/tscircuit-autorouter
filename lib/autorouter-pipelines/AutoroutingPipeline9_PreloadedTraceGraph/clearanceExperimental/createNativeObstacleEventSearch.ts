import { ClearancePathHeap } from "./ClearancePathHeap"
import type { Bounds, RepairRoutePoint as Point } from "./repairRegionTypes"

export type NativeBarrier = {
  a: Point
  b: Point
  radius: number
  minZ: number
  maxZ: number
  viaOnly?: boolean
  pad?: boolean
  isNonPlatedHole?: boolean
  rect?: { width: number; height: number; rotation: number }
  rectCos: number
  rectSin: number
}
type XY = { x: number; y: number }
type Outline = { id:number; barrier: NativeBarrier; points: XY[]; z: number }
type Site = { point: Point; outline?: Outline; vertex?: number; edge?: number }
type State = { site: Site; cost: number; parent?: State; vias: XY[]; key: string }
type Stats = Record<string, number>

function diskContact(a: XY, b: XY, center: XY, radius: number): number {
  const dx = b.x - a.x, dy = b.y - a.y
  const px = a.x - center.x, py = a.y - center.y
  const aa = dx * dx + dy * dy
  const cc = px * px + py * py - radius * radius
  if (cc <= 0) return 0
  if (aa === 0) return Infinity
  const bb = px * dx + py * dy
  const disc = bb * bb - aa * cc
  if (disc < 0) return Infinity
  const t = (-bb - Math.sqrt(disc)) / aa
  return t >= 0 && t <= 1 ? t : Infinity
}
function boxContact(a: XY, b: XY, hx: number, hy: number): number {
  let lo = 0, hi = 1
  for (const [start, delta, half] of [[a.x, b.x - a.x, hx], [a.y, b.y - a.y, hy]]) {
    if (delta === 0) { if (Math.abs(start!) > half!) return Infinity; continue }
    const t1 = (-half! - start!) / delta!, t2 = (half! - start!) / delta!
    lo = Math.max(lo, Math.min(t1, t2)); hi = Math.min(hi, Math.max(t1, t2))
    if (lo > hi) return Infinity
  }
  return lo
}
/** First contact against the native capsule or rounded rotated rectangle. */
export function firstNativeContact(a: XY, b: XY, barrier: NativeBarrier, clearance: number): number {
  const radius = clearance + (barrier.rect ? 0 : barrier.radius)
  const dx = barrier.b.x - barrier.a.x, dy = barrier.b.y - barrier.a.y
  const length = Math.hypot(dx, dy)
  const cos = barrier.rect ? barrier.rectCos : length === 0 ? 1 : dx / length
  const sin = barrier.rect ? barrier.rectSin : length === 0 ? 0 : dy / length
  const cx = barrier.rect ? barrier.a.x : (barrier.a.x + barrier.b.x) / 2
  const cy = barrier.rect ? barrier.a.y : (barrier.a.y + barrier.b.y) / 2
  const local = (p: XY): XY => ({ x: (p.x-cx)*cos+(p.y-cy)*sin, y: -(p.x-cx)*sin+(p.y-cy)*cos })
  const aa = local(a), bb = local(b)
  const hx = barrier.rect ? barrier.rect.width / 2 : length / 2
  const hy = barrier.rect ? barrier.rect.height / 2 : 0
  let first = Math.min(boxContact(aa, bb, hx + radius, hy), boxContact(aa, bb, hx, hy + radius))
  for (const x of [-hx, hx]) for (const y of [-hy, hy]) first = Math.min(first, diskContact(aa, bb, {x,y}, radius))
  return first
}
function hull(points: XY[], stats: Stats): XY[] {
  points.sort((a,b) => a.x-b.x || a.y-b.y)
  const cross = (a: XY,b: XY,c: XY): number => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x)
  const lower: XY[] = [], upper: XY[] = []
  for (const p of points) {
    while (lower.length >= 2) { stats.experimentalEventHullTests++; if (cross(lower.at(-2)!,lower.at(-1)!,p)>0) break; lower.pop() }
    lower.push(p)
  }
  for (const p of [...points].reverse()) {
    while (upper.length >= 2) { stats.experimentalEventHullTests++; if (cross(upper.at(-2)!,upper.at(-1)!,p)>0) break; upper.pop() }
    upper.push(p)
  }
  return [...lower.slice(0,-1),...upper.slice(0,-1)]
}
/** Circumscribed chords never cut through the exact offset boundary. */
export function nativeOffsetOutline(barrier: NativeBarrier, clearance: number, error: number, stats: Stats): XY[] {
  const radius = clearance + (barrier.rect ? 0 : barrier.radius)
  const count = Math.max(8, Math.ceil(Math.PI / Math.acos(radius / (radius + error))))
  const inflated = radius / Math.cos(Math.PI / count) + 1e-9
  const centers: XY[] = barrier.rect ? [-1,1].flatMap(x => [-1,1].map(y => ({
    x: barrier.a.x + x*barrier.rect!.width/2*barrier.rectCos-y*barrier.rect!.height/2*barrier.rectSin,
    y: barrier.a.y + x*barrier.rect!.width/2*barrier.rectSin+y*barrier.rect!.height/2*barrier.rectCos,
  }))) : [barrier.a,barrier.b]
  const points: XY[] = []
  for (const center of centers) for (let i=0;i<count;i++) points.push({x:center.x+inflated*Math.cos(2*Math.PI*i/count), y:center.y+inflated*Math.sin(2*Math.PI*i/count)})
  stats.experimentalEventOutlineVertices += points.length
  stats.experimentalEventMaximumOffsetError = Math.max(stats.experimentalEventMaximumOffsetError, inflated-radius)
  return hull(points,stats)
}
function clipOutline(points:XY[],bounds:Bounds,stats:Stats):XY[]{
  let result=points
  for(const [axis,bound,lower] of [["x",bounds.minX,true],["x",bounds.maxX,false],["y",bounds.minY,true],["y",bounds.maxY,false]] as const){
    const next:XY[]=[]
    for(let i=0;i<result.length;i++){
      const a=result[i]!,b=result[(i+1)%result.length]!,ain=lower?a[axis]>=bound:a[axis]<=bound,bin=lower?b[axis]>=bound:b[axis]<=bound
      stats.experimentalEventClipTests++
      if(ain)next.push(a)
      if(ain!==bin){const t=(bound-a[axis])/(b[axis]-a[axis]);next.push({x:a.x+t*(b.x-a.x),y:a.y+t*(b.y-a.y)})}
    }
    result=next
  }
  return result
}
function tangentVertices(point: XY, outline: Outline, stats: Stats): number[] {
  const result: number[] = [], ps=outline.points
  for (let i=0;i<ps.length;i++) {
    const p=ps[i]!, prev=ps[(i+ps.length-1)%ps.length]!, next=ps[(i+1)%ps.length]!
    const dx=p.x-point.x,dy=p.y-point.y
    if (dx*dx+dy*dy<1e-18) continue
    const c1=dx*(prev.y-p.y)-dy*(prev.x-p.x), c2=dx*(next.y-p.y)-dy*(next.x-p.x)
    stats.experimentalEventTangentTests++
    if (c1*c2 >= -1e-14) result.push(i)
  }
  return result
}
export function createNativeObstacleEventSearch(input: {
  start: Point; end: Point; bounds: Bounds; layerCount: number; grid: number; maxNodes: number; heuristicWeight: number
  allowLayerChanges: boolean; drillSpacing: number; stats: Stats
  clear: (a: Point,b: Point)=>boolean; blocked: ()=>NativeBarrier | undefined
  clearance: (barrier: NativeBarrier, via: boolean)=>number
  costBarriers: NativeBarrier[]
  extraCost: (a: Point,b: Point)=>number
  finish: (path: Point[] | null, reason: "found"|"no-path"|"node-limit")=>void
}): ()=>void {
  const {stats,start,end}=input
  stats.experimentalEventSoftBarrierCount = input.costBarriers.length
  let nextOutlineId=0
  const outlines = new Map<NativeBarrier,Map<number,Outline>>()
  const known = new Map<number,Outline[]>()
  const heap=new ClearancePathHeap(), states: State[]=[]
  const costs=new Map<string,number>()
  const coord=(p:Point):string=>`${p.x},${p.y},${p.z}`
  const add=(site:Site,cost:number,parent:State|undefined,vias:XY[]):void=>{
    const key=coord(site.point)+"|"+(site.outline?`${site.outline.id}:${site.vertex ?? ""}:${site.edge ?? ""}`:"anchor")+"|"+vias.map(p=>`${p.x},${p.y}`).sort().join(";")
    stats.experimentalEventHistoryKeySites += vias.length
    stats.experimentalEventKeyCharacters += key.length
    if (cost >= (costs.get(key) ?? Infinity)) return
    costs.set(key,cost); const id=states.length
    states.push({site,cost,parent,vias,key})
    heap.push({id,cost,priority:cost+input.heuristicWeight*(Math.hypot(site.point.x-end.x,site.point.y-end.y)+(site.point.z===end.z?0:1))})
    stats.experimentalEventQueuedStates++
    stats.experimentalEventMaximumRetainedStates=Math.max(stats.experimentalEventMaximumRetainedStates,states.length)
    stats.experimentalEventMaximumFrontier=Math.max(stats.experimentalEventMaximumFrontier,heap.length)
    stats.experimentalEventMaximumHistoryLength=Math.max(stats.experimentalEventMaximumHistoryLength,vias.length)
  }
  add({point:start},0,undefined,[])
  const outlineFor=(barrier:NativeBarrier,z:number,via:boolean):Outline=>{
    let perLayer=outlines.get(barrier); if(!perLayer){perLayer=new Map();outlines.set(barrier,perLayer)}
    const key=z*2+(via?1:0); const old=perLayer.get(key); if(old)return old
    const outline={id:nextOutlineId++,barrier,z,points:clipOutline(nativeOffsetOutline(barrier,input.clearance(barrier,via),input.grid*0.02,stats),input.bounds,stats)}
    perLayer.set(key,outline); const list=known.get(z) ?? []; list.push(outline); known.set(z,list)
    stats.experimentalEventDiscoveredOutlines++
    return outline
  }
  let popped=0
  return ():void=>{
    const stop=Math.min(popped+128,input.maxNodes)
    while(heap.length && popped<stop){
      const item=heap.pop(), current=states[item.id]!
      popped++; stats.experimentalEventPops=popped
      if(current.cost!==costs.get(current.key))continue
      const a=current.site.point
      if(a.x===end.x && a.y===end.y && a.z===end.z){
        const path:Point[]=[]; for(let s:State|undefined=current;s;s=s.parent)path.push(s.site.point)
        input.finish(path.reverse(),"found"); return
      }
      const attempted=new Set<string>(), pending:Site[]=[{point:{...end,z:a.z}}]
      if(current.site.outline && current.site.vertex !== undefined){
        const o=current.site.outline, i=current.site.vertex
        for(const j of [(i+o.points.length-1)%o.points.length,(i+1)%o.points.length]) pending.push({point:{...o.points[j]!,z:a.z,traceThickness:start.traceThickness},outline:o,vertex:j})
      }
      if(current.site.outline && current.site.edge !== undefined){
        const o=current.site.outline,i=current.site.edge
        for(const j of [i,(i+1)%o.points.length])pending.push({point:{...o.points[j]!,z:a.z,traceThickness:start.traceThickness},outline:o,vertex:j})
      }
      const discover=(barrier:NativeBarrier,viaOnly=false):void=>{
        for(const via of viaOnly ? [true] : input.allowLayerChanges ? [false,true] : [false]){
          const o=outlineFor(barrier,a.z,via)
          for(const j of tangentVertices(a,o,stats)) pending.push({point:{...o.points[j]!,z:a.z,traceThickness:start.traceThickness},outline:o,vertex:j})
          if(via)for(let j=0;j<o.points.length;j++){
            const p=o.points[j]!,q=o.points[(j+1)%o.points.length]!,dx=q.x-p.x,dy=q.y-p.y,den=dx*dx+dy*dy
            if(den===0)continue
            stats.experimentalEventProjectionTests++
            const t=Math.max(0,Math.min(1,((a.x-p.x)*dx+(a.y-p.y)*dy)/den))
            pending.push({point:{x:p.x+t*dx,y:p.y+t*dy,z:a.z,traceThickness:start.traceThickness},outline:o,edge:j})
          }
        }
      }
      const discoverSoft=(b:Point,via:boolean):void=>{
        for(const barrier of input.costBarriers){
          if(!via && (barrier.viaOnly || barrier.minZ>a.z || barrier.maxZ<a.z))continue
          stats.experimentalEventSoftPrimitiveTests++
          if(firstNativeContact(a,b,barrier,input.clearance(barrier,via))!==Infinity)discover(barrier,via)
        }
      }
      for(const o of known.get(a.z) ?? []) if(o!==current.site.outline) for(const j of tangentVertices(a,o,stats)) pending.push({point:{...o.points[j]!,z:a.z,traceThickness:start.traceThickness},outline:o,vertex:j})
      if(input.allowLayerChanges){
        let packable=true
        for(const v of current.vias){stats.experimentalEventHistoryTests++;if((v.x!==a.x||v.y!==a.y)&&Math.hypot(v.x-a.x,v.y-a.y)+1e-8<input.drillSpacing){packable=false;break}}
        if(packable)for(let z=0;z<input.layerCount;z++)if(z!==a.z){
          const b={...a,z};stats.experimentalEventViaCandidates++
          if(!input.clear(a,b)){ const barrier=input.blocked();if(barrier)discover(barrier,true);continue }
          const extra=input.extraCost(a,b);stats.experimentalEventCostQueries++
          if(extra>0)discoverSoft(b,true)
          if(!Number.isFinite(extra))continue
          const vias=current.vias.some(v=>v.x===a.x&&v.y===a.y)?current.vias:[...current.vias,{x:a.x,y:a.y}]
          const o=current.site.outline
          add({point:b,...(o?{outline:{...o,z},vertex:current.site.vertex,edge:current.site.edge}:{})},current.cost+1+extra,current,vias)
        }
      }
      for(let i=0;i<pending.length;i++){
        const site=pending[i]!, b=site.point, key=coord(b)
        if(attempted.has(key) || key===coord(a))continue
        attempted.add(key); stats.experimentalEventSuccessorCandidates++
        if(b.x<input.bounds.minX || b.x>input.bounds.maxX || b.y<input.bounds.minY || b.y>input.bounds.maxY)continue
        if(!input.clear(a,b)){const barrier=input.blocked();if(barrier)discover(barrier);continue}
        const extra=input.extraCost(a,b); stats.experimentalEventCostQueries++
        if(extra>0)discoverSoft(b,false)
        if(Number.isFinite(extra))add(site,current.cost+Math.hypot(a.x-b.x,a.y-b.y)+extra,current,current.vias)
      }

    }
    if(!heap.length || popped>=input.maxNodes)input.finish(null,heap.length?"node-limit":"no-path")
  }
}
