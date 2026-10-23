import { ClearancePathHeap } from "./ClearancePathHeap"
import type { Bounds, RepairRoutePoint as Point } from "./repairRegionTypes"
type XY = {x:number;y:number}
export type ViaCell = Bounds & { certificate?: -1|0|1; children?: ViaCell[] }
type Stats = Record<string,number>
type State = {point:Point;cost:number;parent?:State;vias:XY[];key:string;cell?:ViaCell}

/** Lazy quadtree of continuous domains; a positive certificate covers the entire cell. */
export class LegalViaRegionIndex {
  private roots = new Map<string,ViaCell>()
  constructor(private input: {bounds:Bounds;resolution:number;through:boolean;stats:Stats; classify:(cell:Bounds,from:number,to:number)=>-1|0|1}) {}
  locate(point:Point,to:number):ViaCell {
    const key=this.input.through?"through":`${Math.min(point.z,to)},${Math.max(point.z,to)}`
    let node=this.roots.get(key)
    if(!node){node={...this.input.bounds};this.roots.set(key,node);this.input.stats.experimentalViaRetainedCells++}
    while(true){
      this.input.stats.experimentalViaCellVisits++
      if(node.certificate===undefined){node.certificate=this.input.classify(node,point.z,to);this.input.stats.experimentalViaCellClassifications++;if(node.certificate===1)this.input.stats.experimentalViaCertifiedCells++;if(node.certificate===-1)this.input.stats.experimentalViaBlockedCells++}
      if(node.certificate!==0 || Math.max(node.maxX-node.minX,node.maxY-node.minY)<=this.input.resolution)return node
      if(!node.children){
        const mx:number=(node.minX+node.maxX)/2,my:number=(node.minY+node.maxY)/2
        node.children=[{minX:node.minX,maxX:mx,minY:node.minY,maxY:my},{minX:mx,maxX:node.maxX,minY:node.minY,maxY:my},{minX:node.minX,maxX:mx,minY:my,maxY:node.maxY},{minX:mx,maxX:node.maxX,minY:my,maxY:node.maxY}]
        this.input.stats.experimentalViaRetainedCells+=4;this.input.stats.experimentalViaCellSplits++
      }
      const mx:number=(node.minX+node.maxX)/2,my:number=(node.minY+node.maxY)/2
      node=node.children[(point.y>=my?2:0)+(point.x>=mx?1:0)]!
    }
  }
}
/** Generate coordinates only when a concrete route needs this legal domain. */
export function realizeViaCell(input:{cell:ViaCell;source:Point;target:Point;vias:XY[];spacing:number;stats:Stats}):XY[]{
  const {cell,source,target,vias,spacing,stats}=input
  const clamp=(p:XY):XY=>({x:Math.max(cell.minX,Math.min(cell.maxX,p.x)),y:Math.max(cell.minY,Math.min(cell.maxY,p.y))})
  const candidates:XY[]=[{x:source.x,y:source.y},clamp(target)]
  // Circle/rectangle intersection events provide witnesses when the preferred
  // coordinate is excluded by an earlier drill. Their legality is checked below.
  for(const via of vias){
    stats.experimentalViaPackingDomainTests++
    const radius=spacing+1e-8
    for(const x of [cell.minX,cell.maxX]){
      const square=radius*radius-(x-via.x)**2
      if(square>=0)for(const y of [via.y-Math.sqrt(square),via.y+Math.sqrt(square)])candidates.push({x,y})
    }
    for(const y of [cell.minY,cell.maxY]){
      const square=radius*radius-(y-via.y)**2
      if(square>=0)for(const x of [via.x-Math.sqrt(square),via.x+Math.sqrt(square)])candidates.push({x,y})
    }
    const angle=Math.atan2(target.y-via.y,target.x-via.x)
    candidates.push({x:via.x+radius*Math.cos(angle),y:via.y+radius*Math.sin(angle)})
  }
  const seen=new Set<string>(),result:XY[]=[]
  for(const p of candidates){
    stats.experimentalViaCoordinateWitnesses++
    if(p.x<cell.minX || p.x>cell.maxX || p.y<cell.minY || p.y>cell.maxY)continue
    const key=`${p.x},${p.y}`;if(seen.has(key))continue;seen.add(key)
    let valid=true
    for(const v of vias){stats.experimentalViaHistoryTests++;if((v.x!==p.x||v.y!==p.y)&&Math.hypot(v.x-p.x,v.y-p.y)+1e-8<spacing){valid=false;stats.experimentalViaPackingRejectedWitnesses++;break}}
    if(valid)result.push(p)
  }
  return result
}
export function createDeferredViaRegionSearch(input:{start:Point;end:Point;bounds:Bounds;layerCount:number;grid:number;maxNodes:number;heuristicWeight:number;allowLayerChanges:boolean;drillSpacing:number;through:boolean;stats:Stats;clear:(a:Point,b:Point)=>boolean;classify:(cell:Bounds,from:number,to:number)=>-1|0|1;extraCost:(a:Point,b:Point)=>number;finish:(path:Point[]|null,reason:"found"|"no-path"|"node-limit")=>void}):()=>void{
  const {start,end,grid,bounds,stats}=input
  const nx=Math.floor((bounds.maxX-bounds.minX)/grid),ny=Math.floor((bounds.maxY-bounds.minY)/grid)
  const regions=new LegalViaRegionIndex({bounds,resolution:grid,through:input.through,stats,classify:input.classify})
  const heap=new ClearancePathHeap(),states:State[]=[],costs=new Map<string,number>()
  const add=(point:Point,cost:number,parent:State|undefined,vias:XY[],cell?:ViaCell):void=>{
    const key=`${point.x},${point.y},${point.z}|${cell?`${cell.minX},${cell.maxX},${cell.minY},${cell.maxY}`:"grid"}|`+vias.map(v=>`${v.x},${v.y}`).sort().join(";")
    stats.experimentalViaHistoryKeySites += vias.length
    stats.experimentalViaKeyCharacters += key.length
    if(cost >= (costs.get(key)??Infinity))return
    costs.set(key,cost);const id=states.length;states.push({point,cost,parent,vias,key,cell})
    heap.push({id,cost,priority:cost+input.heuristicWeight*(Math.hypot(point.x-end.x,point.y-end.y)+(point.z===end.z?0:1))});stats.experimentalViaQueuedStates++
    stats.experimentalViaMaximumRetainedStates=Math.max(stats.experimentalViaMaximumRetainedStates,states.length)
    stats.experimentalViaMaximumFrontier=Math.max(stats.experimentalViaMaximumFrontier,heap.length)
    stats.experimentalViaMaximumHistoryLength=Math.max(stats.experimentalViaMaximumHistoryLength,vias.length)
  }
  const gridPoint=(x:number,y:number,z:number):Point=>({x:bounds.minX+(x+0.5)*grid,y:bounds.minY+(y+0.5)*grid,z,traceThickness:start.traceThickness})
  const localGrid=(a:Point,reach:number):Point[]=>{
    const x=Math.max(0,Math.min(nx-1,Math.floor((a.x-bounds.minX)/grid))),y=Math.max(0,Math.min(ny-1,Math.floor((a.y-bounds.minY)/grid)))
    const result:Point[]=[]
    for(let dx=-reach;dx<=reach;dx++)for(let dy=-reach;dy<=reach;dy++)if(x+dx>=0&&x+dx<nx&&y+dy>=0&&y+dy<ny)result.push(gridPoint(x+dx,y+dy,a.z))
    return result
  }
  for(const p of localGrid(start,2)){
    if(!input.clear(start,p))continue
    const cost=Math.hypot(start.x-p.x,start.y-p.y)+input.extraCost(start,p)
    if(Number.isFinite(cost))add(p,cost,{point:start,cost:0,vias:[],key:"anchor"},[])
  }
  let popped=0
  return ():void=>{
    const stop=Math.min(popped+128,input.maxNodes)
    while(heap.length&&popped<stop){
      const item=heap.pop(),current=states[item.id]!;popped++;stats.experimentalViaPops=popped
      if(current.cost!==costs.get(current.key))continue
      const a=current.point
      if(a.x===end.x&&a.y===end.y&&a.z===end.z){
        const path:Point[]=[];for(let s:State|undefined=current;s;s=s.parent)path.push(s.point)
        input.finish(path.reverse(),"found");return
      }
      const close=Math.hypot(a.x-end.x,a.y-end.y)<grid*3
      const cell=current.cell
      const targetInCell=cell&&end.x>=cell.minX&&end.x<=cell.maxX&&end.y>=cell.minY&&end.y<=cell.maxY
      const neighbors=localGrid(a,1)
      if(a.z===end.z&&(close||targetInCell))neighbors.push(end)
      for(const b of neighbors){
        if(a.x===b.x&&a.y===b.y)continue
        stats.experimentalViaPlanarCandidates++
        if(!input.clear(a,b))continue
        const extra=input.extraCost(a,b);stats.experimentalViaCostQueries++
        if(Number.isFinite(extra))add(b,current.cost+Math.hypot(a.x-b.x,a.y-b.y)+extra,current,current.vias,cell&&b.x>=cell.minX&&b.x<=cell.maxX&&b.y>=cell.minY&&b.y<=cell.maxY?cell:undefined)
      }
      if(!input.allowLayerChanges)continue
      for(let z=0;z<input.layerCount;z++)if(z!==a.z){
        const domain=regions.locate(a,z)
        if(domain.certificate===-1)continue
        const witnesses=realizeViaCell({cell:domain,source:a,target:end,vias:current.vias,spacing:input.drillSpacing,stats})
        for(const p of witnesses){
          const entry={...a,...p},exit={...entry,z};stats.experimentalViaTransitionCandidates++
          if((a.x!==p.x||a.y!==p.y)&&!input.clear(a,entry))continue
          if(domain.certificate!==1){stats.experimentalViaBoundaryWitnessChecks++;if(!input.clear(entry,exit))continue}
          else stats.experimentalViaCertifiedWitnessUses++
          const approach=input.extraCost(a,entry),via=input.extraCost(entry,exit);stats.experimentalViaCostQueries+=2
          if(!Number.isFinite(approach)||!Number.isFinite(via))continue
          const approachState:State=(a.x===p.x&&a.y===p.y)?current:{point:entry,cost:current.cost+Math.hypot(a.x-p.x,a.y-p.y)+approach,parent:current,vias:current.vias,key:"entry"}
          const vias=current.vias.some(v=>v.x===p.x&&v.y===p.y)?current.vias:[...current.vias,p]
          add(exit,approachState.cost+1+via,approachState,vias,domain.certificate===1?domain:undefined)
        }
      }
    }
    if(!heap.length||popped>=input.maxNodes)input.finish(null,heap.length?"node-limit":"no-path")
  }
}
