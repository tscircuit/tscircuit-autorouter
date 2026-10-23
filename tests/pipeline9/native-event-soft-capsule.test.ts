import { test, expect } from "bun:test"
import { segmentToSegmentMinDistance } from "@tscircuit/math-utils"
import { FindClearancePathSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearanceExperimental/FindClearancePathSolver"
test("positive movable-copper costs discover native detour events", () => {
 const route={connectionName:"a",traceThickness:0.1,viaDiameter:0.3,route:[{x:-3,y:0,z:0},{x:3,y:0,z:0}],vias:[]}
 const barrier={a:{x:0,y:-1,z:0},b:{x:0,y:1,z:0},radius:0.1,minZ:0,maxZ:0,rectCos:1,rectSin:0}
 const srj={layerCount:2,minTraceWidth:0.1,bounds:{minX:-4,maxX:4,minY:-3,maxY:3},connections:[],obstacles:[]}
 const solver=new FindClearancePathSolver({srj,routes:[route],routeIndex:0,start:route.route[0]!,end:route.route[1]!,bounds:srj.bounds,traceThickness:0.1,traceClearance:0.1,viaClearance:0.1,gridSize:0.1,allowLayerChanges:false,maxNodes:30000,eventCostBarriers:[barrier],getAdditionalEdgeCost:(a,b)=>segmentToSegmentMinDistance(a,b,barrier.a,barrier.b)<0.25?Math.hypot(a.x-b.x,a.y-b.y)*20:0})
 solver.solve();expect(solver.failed).toBe(false);const path=solver.getOutput();expect(path).not.toBeNull()
 for(let i=1;i<path!.length;i++)expect(segmentToSegmentMinDistance(path![i-1]!,path![i]!,barrier.a,barrier.b)).toBeGreaterThanOrEqual(0.25-1e-8)
 expect(solver.stats.experimentalEventSoftPrimitiveTests).toBeGreaterThan(0)
})
