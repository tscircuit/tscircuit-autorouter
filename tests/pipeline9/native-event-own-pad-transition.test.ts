import { test, expect } from "bun:test"
import { getFixedObstacleViolations, getNewViaPadViolations } from "@tscircuit/repair04"
import { FindClearancePathSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearanceExperimental/FindClearancePathSolver"
test("blocked vias in own terminal pads discover an interior legal transition event", () => {
 const route={connectionName:"a",traceThickness:0.1,viaDiameter:0.3,route:[{x:-2,y:0,z:0},{x:-2,y:0,z:1},{x:2,y:0,z:1}],vias:[]}
 const srj={layerCount:2,minTraceWidth:0.1,bounds:{minX:-3,maxX:3,minY:-2,maxY:2},connections:[{name:"a",pointsToConnect:[{x:-2,y:0,layer:"top"},{x:2,y:0,layer:"bottom"}]}],obstacles:[-2,2].map((x)=>({type:"rect" as const,center:{x,y:0},width:0.8,height:0.8,layers:[x<0?"top":"bottom"],connectedTo:["a"]})),defaultObstacleMargin:0.1}
 const solver=new FindClearancePathSolver({srj,routes:[route],routeIndex:0,start:route.route[0]!,end:route.route.at(-1)!,bounds:srj.bounds,traceThickness:0.1,traceClearance:0.1,viaClearance:0.1,gridSize:0.1,maxNodes:30000})
 solver.solve();expect(solver.failed).toBe(false);const path=solver.getOutput();expect(path).not.toBeNull()
 const output={...route,route:path!};expect(getFixedObstacleViolations({srj,routes:[output],traceClearance:0.1,viaClearance:0.1})).toHaveLength(0)
 expect(getNewViaPadViolations({srj,previousRoutes:[route],routes:[output],viaClearance:0.1})).toHaveLength(0)
 expect(path!.some((p,i)=>i>0&&p.z!==path![i-1]!.z)).toBe(true)
 expect(solver.stats.experimentalEventDiscoveredOutlines).toBeGreaterThan(0)
})
