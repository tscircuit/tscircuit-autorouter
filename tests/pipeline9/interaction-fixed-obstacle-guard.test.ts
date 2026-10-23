import { test, expect } from "bun:test"
import { Pipeline9InteractionGroupedHighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9InteractionGroupedHighDensitySolver"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types"
test("an obstacle-violating independent plan is rejected as an unknown candidate failure", () => {
 const node:NodeWithPortPoints={capacityMeshNodeId:"obstacle",center:{x:0,y:0},width:6,height:6,availableZ:[0,1],portPoints:[{connectionName:"a",x:-2,y:0,z:0},{connectionName:"a",x:2,y:0,z:0}]}
 const srj:SimpleRouteJson={layerCount:2,minTraceWidth:0.1,bounds:{minX:-3,maxX:3,minY:-3,maxY:3},obstacles:[{type:"rect",center:{x:0,y:0},width:0.5,height:0.5,layers:["top"],connectedTo:["foreign"]}],connections:[{name:"a",pointsToConnect:[{x:-2,y:0,layer:"top"},{x:2,y:0,layer:"top"}]}]}
 const solver=new Pipeline9InteractionGroupedHighDensitySolver({nodePortPoints:[node],useGrowShrinkHighDensityIntraNodeSolver:true,enableNegotiatedSearch:true,gridSearchSegmentWork:500,growShrinkFallbackToInvalidGeometryOnFailure:false,connMap:getConnectivityMapFromSimpleRouteJson(srj),colorMap:{},viaDiameter:0.3,traceWidth:0.1,obstacleMargin:0.1,effort:1,nodePfById:new Map(),obstacles:srj.obstacles,layerCount:2,boardGeometry:{bounds:srj.bounds}})
 solver.solve()
 expect(solver.failed).toBe(true)
 expect(solver.solved).toBe(false)
 expect(solver.routes).toHaveLength(0)
 expect(solver.stats.experimentalInteractionCandidateRejections).toBeGreaterThan(0)
 expect(solver.stats.experimentalInteractionUnknownGroupFailures).toBe(1)
 expect(solver.error).toContain("not physical UNSAT")
})
