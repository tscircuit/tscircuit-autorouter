import { test, expect } from "bun:test"
import { getFixedObstacleViolations } from "@tscircuit/repair04"
import { FindClearancePathSolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/clearanceExperimental/FindClearancePathSolver"
test("touching obstacle outlines preserve all required boundary continuations", () => {
 const route={connectionName:"a",traceThickness:0.1,viaDiameter:0.3,route:[{x:-3,y:0,z:0},{x:3,y:0,z:0}],vias:[]}
 const srj={layerCount:2,minTraceWidth:0.1,bounds:{minX:-4,maxX:4,minY:-3,maxY:3},connections:[],obstacles:[-0.65,0.65].map(x=>({type:"oval" as const,center:{x,y:0},width:1,height:1,layers:["top","bottom"],connectedTo:["foreign"]})),defaultObstacleMargin:0.1}
 const solver=new FindClearancePathSolver({srj,routes:[route],routeIndex:0,start:route.route[0]!,end:route.route[1]!,bounds:srj.bounds,traceThickness:0.1,traceClearance:0.1,viaClearance:0.1,gridSize:0.1,allowLayerChanges:false,maxNodes:30000})
 solver.solve();const path=solver.getOutput();expect(path).not.toBeNull()
 expect(getFixedObstacleViolations({srj,routes:[{...route,route:path!}],traceClearance:0.1,viaClearance:0.1})).toHaveLength(0)
 expect(solver.stats.experimentalEventDiscoveredOutlines).toBeGreaterThanOrEqual(2)
})
