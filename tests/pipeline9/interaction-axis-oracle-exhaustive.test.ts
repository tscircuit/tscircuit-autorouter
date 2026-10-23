import { test, expect } from "bun:test"
import { doInteractionRoutesConflict } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9InteractionGroupedHighDensitySolver"
import type { HighDensityRoute } from "lib/types/high-density-types"
test("capsule interactions agree with closed-form axis-segment distances on a finite exhaustive domain", () => {
 type Line={horizontal:boolean;lo:number;hi:number;fixed:number}
 const lines:Line[]=[]
 for(const horizontal of [false,true])for(const lo of [-0.4,0,0.4])for(const hi of [-0.4,0,0.4])if(hi>=lo)for(const fixed of [-0.4,0,0.4])lines.push({horizontal,lo,hi,fixed})
 const route=(line:Line,z:number,name:string):HighDensityRoute=>({connectionName:name,traceThickness:0.2,viaDiameter:0.3,route:line.horizontal?[{x:line.lo,y:line.fixed,z},{x:line.hi,y:line.fixed,z}]:[{x:line.fixed,y:line.lo,z},{x:line.fixed,y:line.hi,z}],vias:[]})
 const stats={experimentalInteractionCopperPrimitiveTests:0}
 for(const a of lines)for(const b of lines){
  let distance:number
  if(a.horizontal===b.horizontal)distance=Math.hypot(Math.max(a.lo-b.hi,b.lo-a.hi,0),a.fixed-b.fixed)
  else{const h=a.horizontal?a:b,v=a.horizontal?b:a;distance=Math.hypot(Math.max(h.lo-v.fixed,v.fixed-h.hi,0),Math.max(v.lo-h.fixed,h.fixed-v.hi,0))}
  const left=route(a,0,"a"),right=route(b,0,"b")
  // Zero-length geometric segments carry no wire copper in the native model.
  const expected=a.lo!==a.hi&&b.lo!==b.hi&&distance+1e-8<0.3
  expect(doInteractionRoutesConflict({left,right,sameNet:false,clearance:0.1,layerCount:2,stats})).toBe(expected)
  expect(doInteractionRoutesConflict({left,right:route(b,1,"b"),sameNet:false,clearance:0.1,layerCount:2,stats})).toBe(false)
  expect(doInteractionRoutesConflict({left,right,sameNet:true,clearance:0.1,layerCount:2,stats})).toBe(false)
 }
})
