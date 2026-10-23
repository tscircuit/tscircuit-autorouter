import { expect, test } from "bun:test"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import { Pipeline9InteractionGroupedHighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9InteractionGroupedHighDensitySolver"
import type { HighDensityRoute, NodeWithPortPoints, PortPoint } from "lib/types/high-density-types"
import type { Obstacle } from "lib/types"

test("canonical root keys cannot be reinterpreted as foreign aliases in grouping, copper or imported-pad guards", () => {
  const connMap=new ConnectivityMap({connectivity_net0:["wire","own-pad"],connectivity_net1:["connectivity_net0","other-wire","foreign-pad"]})
  const points:PortPoint[]=[{connectionName:"wire",rootConnectionName:"connectivity_net0",x:-2,y:0,z:0},{connectionName:"wire",rootConnectionName:"connectivity_net0",x:2,y:0,z:0},{connectionName:"other-wire",rootConnectionName:"connectivity_net1",x:0,y:-2,z:0},{connectionName:"other-wire",rootConnectionName:"connectivity_net1",x:0,y:2,z:0}]
  const node:NodeWithPortPoints={capacityMeshNodeId:"namespace",center:{x:0,y:0},width:6,height:6,availableZ:[0,1],portPoints:points,portPointsInPairs:[[points[0]!,points[1]!],[points[2]!,points[3]!]]}
  const params={nodePortPoints:[node],connMap,viaDiameter:0.3,traceWidth:0.1,obstacleMargin:0.1,layerCount:2,effort:1,obstacles:[] as Obstacle[],useGrowShrinkHighDensityIntraNodeSolver:true,enableNegotiatedSearch:true,gridSearchSegmentWork:500,growShrinkFallbackToInvalidGeometryOnFailure:false}
  const routes:HighDensityRoute[]=["wire","other-wire"].map(name=>({connectionName:name,rootConnectionName:points.find(point=>point.connectionName===name)!.rootConnectionName,regionId:node.capacityMeshNodeId,traceThickness:0.1,viaDiameter:0.3,vias:[],route:points.filter(point=>point.connectionName===name).map(point=>({x:point.x,y:point.y,z:point.z}))}))
  const solver=new Pipeline9InteractionGroupedHighDensitySolver(params)
  const internal=solver as unknown as {initializeGroups():void;groups:unknown[];haveConflict(left:HighDensityRoute,right:HighDensityRoute):boolean;validateGroup(routes:HighDensityRoute[],node:NodeWithPortPoints):boolean}
  internal.initializeGroups()
  expect(internal.groups).toHaveLength(2)
  expect(internal.haveConflict(routes[0]!,routes[1]!)).toBe(true)
  expect(internal.validateGroup(routes,node)).toBe(false)
  const descriptiveNode={...node,portPoints:points.map(point=>({...point,rootConnectionName:"unregistered-common-label"})),portPointsInPairs:undefined}
  const descriptiveRoutes=routes.map(route=>({...route,rootConnectionName:"unregistered-common-label"}))
  const authoritative=new Pipeline9InteractionGroupedHighDensitySolver({...params,nodePortPoints:[descriptiveNode]})
  const authoritativeInternal=authoritative as unknown as typeof internal
  authoritativeInternal.initializeGroups()
  expect(authoritativeInternal.groups).toHaveLength(2)
  expect(authoritativeInternal.haveConflict(descriptiveRoutes[0]!,descriptiveRoutes[1]!)).toBe(true)
  expect(authoritativeInternal.validateGroup(descriptiveRoutes,descriptiveNode)).toBe(false)
  const absent=new Pipeline9InteractionGroupedHighDensitySolver({...params,nodePortPoints:[descriptiveNode],connMap:new ConnectivityMap({})})
  const absentInternal=absent as unknown as typeof internal
  absentInternal.initializeGroups()
  expect(absentInternal.groups).toHaveLength(1)
  const one:NodeWithPortPoints={...node,portPoints:points.slice(0,2),portPointsInPairs:[[points[0]!,points[1]!]]}
  const obstacle:Obstacle={type:"rect",center:{x:0,y:0},width:0.2,height:0.2,layers:["top"],connectedTo:["foreign-pad","connectivity_net0"]}
  const originalRoute=JSON.stringify(routes[0]),originalObstacle=JSON.stringify(obstacle)
  const foreign=new Pipeline9InteractionGroupedHighDensitySolver({...params,nodePortPoints:[one],obstacles:[obstacle]})
  const foreignValidate=(foreign as unknown as {validateGroup(routes:HighDensityRoute[],node:NodeWithPortPoints):boolean}).validateGroup.bind(foreign)
  expect(foreignValidate([routes[0]!],one)).toBe(false)
  const descriptiveOne={...one,portPoints:descriptiveNode.portPoints.slice(0,2),portPointsInPairs:undefined}
  const descriptivePad=new Pipeline9InteractionGroupedHighDensitySolver({...params,nodePortPoints:[descriptiveOne],obstacles:[obstacle]})
  expect((descriptivePad as unknown as typeof internal).validateGroup([descriptiveRoutes[0]!],descriptiveOne)).toBe(false)
  expect(JSON.stringify(routes[0])).toBe(originalRoute)
  expect(JSON.stringify(obstacle)).toBe(originalObstacle)
  const own=new Pipeline9InteractionGroupedHighDensitySolver({...params,nodePortPoints:[one],obstacles:[{...obstacle,connectedTo:["own-pad","wire"]}]})
  expect((own as unknown as {validateGroup(routes:HighDensityRoute[],node:NodeWithPortPoints):boolean}).validateGroup([routes[0]!],one)).toBe(true)
  const full=new Pipeline9InteractionGroupedHighDensitySolver(params)
  full.solve()
  expect(full.failed,full.error??"").toBe(false)
  expect(full.solved).toBe(true)
  expect(full.stats.experimentalInteractionInitialGroups).toBe(2)
  expect(full.stats.experimentalInteractionMergeEvents).toBe(1)
  for(const route of full.routes){
    expect(route.rootConnectionName).toBe(connMap.getNetConnectedToId(route.connectionName))
    expect(route.regionId).toBe(node.capacityMeshNodeId)
    expect(route.connectionName.startsWith("pipeline9_interaction_guard_")).toBe(false)
  }
})
