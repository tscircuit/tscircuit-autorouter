import { test, expect } from "bun:test"
import { getFixedObstacleViolations } from "@tscircuit/repair04"
import { FindClearancePathSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearanceExperimental/FindClearancePathSolver"
test("through-via region certificates include obstacles on intermediate layers", () => {
 const route={connectionName:"a",traceThickness:0.1,viaDiameter:0.3,route:[{x:-1,y:0,z:0},{x:1,y:0,z:3}],vias:[]}
 const srj={layerCount:4,minTraceWidth:0.1,bounds:{minX:-3,maxX:3,minY:-2,maxY:2},connections:[{name:"a",pointsToConnect:[{x:-1,y:0,layer:"top"},{x:1,y:0,layer:"bottom"}]}],obstacles:[{type:"rect" as const,center:{x:0,y:0},width:3,height:3,layers:["inner1"],connectedTo:["foreign"]}],defaultObstacleMargin:0.1}
 const solver=new FindClearancePathSolver({srj,routes:[route],routeIndex:0,start:route.route[0]!,end:route.route[1]!,bounds:srj.bounds,traceThickness:0.1,traceClearance:0.1,viaClearance:0.1,gridSize:0.1,maxNodes:30000})
 solver.solve();expect(solver.failed).toBe(false);const path=solver.getOutput();expect(path).not.toBeNull()
 const vias=path!.filter((p,i)=>i>0&&p.z!==path![i-1]!.z)
 expect(vias.length).toBeGreaterThan(0)
 for(const via of vias)expect(Math.max(Math.abs(via.x)-1.5,Math.abs(via.y)-1.5)).toBeGreaterThanOrEqual(0.25-1e-8)
 expect(getFixedObstacleViolations({srj,routes:[{...route,route:path!}],traceClearance:0.1,viaClearance:0.1})).toHaveLength(0)
 expect(solver.stats.experimentalViaRegionPrimitiveTests).toBeGreaterThan(0)
 expect(solver.stats.experimentalViaBoundaryWitnessChecks).toBeGreaterThan(0)
})
