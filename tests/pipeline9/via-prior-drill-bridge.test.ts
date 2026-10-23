import { test, expect } from "bun:test"
import { getFixedObstacleViolations } from "@tscircuit/repair04"
import { FindClearancePathSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearanceExperimental/FindClearancePathSolver"
test("two-via bridge retains prior drill influence across layers", () => {
 const route={connectionName:"a",traceThickness:0.1,viaDiameter:0.3,route:[{x:-0.3,y:0,z:0},{x:0.3,y:0,z:0}],vias:[]}
 const srj={layerCount:2,minTraceWidth:0.1,bounds:{minX:-2,maxX:2,minY:-2,maxY:2},connections:[],obstacles:[{type:"rect" as const,center:{x:0,y:0},width:0.1,height:6,layers:["top"],connectedTo:["foreign"]}],defaultObstacleMargin:0.1}
 const solver=new FindClearancePathSolver({srj,routes:[route],routeIndex:0,start:route.route[0]!,end:route.route[1]!,bounds:srj.bounds,traceThickness:0.1,traceClearance:0.1,viaClearance:0.5,viaHoleDiameter:0.3,gridSize:0.2,maxNodes:30000})
 solver.solve();expect(solver.failed).toBe(false);const path=solver.getOutput();expect(path).not.toBeNull()
 const vias=path!.filter((p,i)=>i>0&&p.z!==path![i-1]!.z)
 expect(vias.length).toBeGreaterThanOrEqual(2)
 for(let i=0;i<vias.length;i++)for(let j=i+1;j<vias.length;j++)if(vias[i]!.x!==vias[j]!.x||vias[i]!.y!==vias[j]!.y)expect(Math.hypot(vias[i]!.x-vias[j]!.x,vias[i]!.y-vias[j]!.y)).toBeGreaterThanOrEqual(0.8-1e-8)
 expect(getFixedObstacleViolations({srj,routes:[{...route,route:path!}],traceClearance:0.1,viaClearance:0.5})).toHaveLength(0)
 expect(solver.stats.experimentalViaHistoryTests).toBeGreaterThan(0)
})
