import { test, expect } from "bun:test"
import { getInteractionComponents } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9InteractionGroupedHighDensitySolver"
test("interaction components match exhaustive reachability for every four-group graph", () => {
 const pairs:[number,number][]=[[0,1],[0,2],[0,3],[1,2],[1,3],[2,3]]
 for(let mask=0;mask<64;mask++){
  const edges=pairs.filter((_,i)=>mask&(1<<i)),components=getInteractionComponents(4,edges)
  for(let a=0;a<4;a++)for(let b=0;b<4;b++){
   const reached=new Set([a]);let changed=true
   while(changed){changed=false;for(const [x,y] of edges)if(reached.has(x)||reached.has(y)){const before=reached.size;reached.add(x);reached.add(y);changed=changed||before!==reached.size}}
   expect(components.some(group=>group.includes(a)&&group.includes(b))).toBe(reached.has(b))
  }
 }
})
