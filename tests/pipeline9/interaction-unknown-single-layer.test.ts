import { test, expect } from "bun:test"
import { Pipeline9InteractionGroupedHighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9InteractionGroupedHighDensitySolver"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types"
test("a failed coupled candidate is reported as unknown rather than physical UNSAT", () => {
 const node:NodeWithPortPoints={capacityMeshNodeId:"one-layer",center:{x:0,y:0},width:4,height:4,availableZ:[0],portPoints:[{connectionName:"a",x:-2,y:0,z:0},{connectionName:"a",x:2,y:0,z:0},{connectionName:"b",x:0,y:-2,z:0},{connectionName:"b",x:0,y:2,z:0}]}
 const srj:SimpleRouteJson={layerCount:1,minTraceWidth:0.1,bounds:{minX:-2,maxX:2,minY:-2,maxY:2},obstacles:[],connections:["a","b"].map(name=>({name,pointsToConnect:node.portPoints.filter(p=>p.connectionName===name).map(p=>({x:p.x,y:p.y,layer:"top"}))}))}
 const solver=new Pipeline9InteractionGroupedHighDensitySolver({nodePortPoints:[node],useGrowShrinkHighDensityIntraNodeSolver:true,enableNegotiatedSearch:true,gridSearchSegmentWork:500,growShrinkFallbackToInvalidGeometryOnFailure:false,connMap:getConnectivityMapFromSimpleRouteJson(srj),colorMap:{},viaDiameter:0.3,traceWidth:0.1,obstacleMargin:0.1,effort:1,nodePfById:new Map(),obstacles:[],layerCount:1})
 solver.solve();expect(solver.failed).toBe(true);expect(solver.solved).toBe(false)
 expect(solver.stats.experimentalInteractionMergeEvents).toBe(1)
 expect(solver.stats.experimentalInteractionUnknownGroupFailures).toBe(1)
 expect(solver.error).toContain("not physical UNSAT")
})
