import { test, expect } from "bun:test"
import { Pipeline9InteractionGroupedHighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9InteractionGroupedHighDensitySolver"
import { areNodePortPointPairsConnectedByRoutes } from "lib/solvers/HyperHighDensitySolver/repairDisconnectedSameRootPortPoints"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import type { HighDensityRoute, NodeWithPortPoints } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types"
test("actual crossing merges only its groups and retains an unaffected physical reservation", () => {
 const node:NodeWithPortPoints={capacityMeshNodeId:"node",center:{x:0,y:0},width:6,height:6,availableZ:[0,1],portPoints:[{connectionName:"a",rootConnectionName:"a",x:-2,y:0,z:0},{connectionName:"a",rootConnectionName:"a",x:2,y:0,z:0},{connectionName:"b",rootConnectionName:"b",x:0,y:-2,z:0},{connectionName:"b",rootConnectionName:"b",x:0,y:2,z:0},{connectionName:"c",rootConnectionName:"c",x:-2,y:2.7,z:0},{connectionName:"c",rootConnectionName:"c",x:2,y:2.7,z:0}]}
 const srj:SimpleRouteJson={layerCount:2,minTraceWidth:0.1,bounds:{minX:-3,maxX:3,minY:-3,maxY:3},obstacles:[],connections:["a","b","c"].map(name=>({name,pointsToConnect:node.portPoints.filter(p=>p.connectionName===name).map(p=>({x:p.x,y:p.y,layer:"top"}))}))}
 const solver=new Pipeline9InteractionGroupedHighDensitySolver({nodePortPoints:[node],useGrowShrinkHighDensityIntraNodeSolver:true,enableNegotiatedSearch:true,gridSearchSegmentWork:500,growShrinkFallbackToInvalidGeometryOnFailure:false,connMap:getConnectivityMapFromSimpleRouteJson(srj),colorMap:{},viaDiameter:0.3,traceWidth:0.1,obstacleMargin:0.1,effort:1,nodePfById:new Map(),obstacles:[],layerCount:2})
 const internal=solver as unknown as {groups:Array<{routes?:HighDensityRoute[]}>}
 let retained:HighDensityRoute|undefined
 while(!solver.solved&&!solver.failed){
   if(solver.stats.experimentalInteractionGroupPlans===3&&internal.groups.every(g=>g.routes))retained=internal.groups.flatMap(g=>g.routes!).find(route=>route.connectionName==="c")
   solver.step()
 }
 expect(solver.failed,solver.error??"").toBe(false)
 expect(solver.stats.experimentalInteractionInitialGroups).toBe(3)
 expect(solver.stats.experimentalInteractionMergeEvents).toBe(1)
 expect(solver.stats.experimentalInteractionMaximumGroupConnections).toBe(2)
 expect(solver.stats.experimentalInteractionRetainedGroupsAtMerge).toBe(1)
 expect(solver.stats.experimentalInteractionReservationChecks).toBeGreaterThan(0)
 expect(solver.routes.find(route=>route.connectionName==="c")).toBe(retained)
 expect(areNodePortPointPairsConnectedByRoutes(solver.routes,node)).toBe(true)
 for(const route of solver.routes)expect(route.traceThickness).toBe(0.1)
 expect(solver.stats.experimentalInteractionChildAllocatedIterations).toBeGreaterThan(solver.stats.experimentalInteractionNodeIterationAllowance)
})
