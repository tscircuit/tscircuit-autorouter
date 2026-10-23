import { expect, test } from "bun:test"
import { Pipeline9InteractionGroupedHighDensitySolver } from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/Pipeline9InteractionGroupedHighDensitySolver"
import { getConnectivityMapFromSimpleRouteJson } from "lib/utils/getConnectivityMapFromSimpleRouteJson"
import type { HighDensityRoute, NodeWithPortPoints, PortPoint } from "lib/types/high-density-types"
import type { SimpleRouteJson } from "lib/types"

test("group witness requires its owning region and requested endpoint identities in actual route direction", () => {
  const points:PortPoint[]=[{connectionName:"a",rootConnectionName:"root-a",pcb_port_id:"a-start",x:-2,y:0,z:0},{connectionName:"a",rootConnectionName:"root-a",pcb_port_id:"a-end",x:2,y:0,z:0}]
  const node:NodeWithPortPoints={capacityMeshNodeId:"owner",center:{x:0,y:0},width:6,height:6,availableZ:[0,1],portPoints:points,portPointsInPairs:[[points[0]!,points[1]!]]}
  const srj:SimpleRouteJson={layerCount:2,minTraceWidth:0.1,bounds:{minX:-3,maxX:3,minY:-3,maxY:3},obstacles:[],connections:[{name:"a",rootConnectionName:"root-a",pointsToConnect:points.map(point=>({...point,layer:"top"}))}]}
  const params={nodePortPoints:[node],connMap:getConnectivityMapFromSimpleRouteJson(srj),viaDiameter:0.3,traceWidth:0.1,obstacleMargin:0.1,effort:1,obstacles:[],layerCount:2,useGrowShrinkHighDensityIntraNodeSolver:true,growShrinkFallbackToInvalidGeometryOnFailure:false}
  const solver=new Pipeline9InteractionGroupedHighDensitySolver({...params,preserveTerminalPcbPortIds:true})
  solver.solve()
  expect(solver.failed,solver.error??"").toBe(false)
  expect(solver.solved).toBe(true)
  expect(solver.routes).toHaveLength(1)
  const route=solver.routes[0]!
  const validate=(solver as unknown as {validateGroup(routes:HighDensityRoute[],node:NodeWithPortPoints):boolean}).validateGroup.bind(solver)
  expect(validate([route],node)).toBe(true)
  expect(route.regionId).toBe(node.capacityMeshNodeId)
  expect(validate([{...route,regionId:undefined}],node)).toBe(false)
  expect(validate([{...route,regionId:"foreign-region"}],node)).toBe(false)
  expect(validate([{...route,startPcbPortId:"foreign-start"}],node)).toBe(false)
  expect(validate([{...route,endPcbPortId:"foreign-end"}],node)).toBe(false)
  expect(validate([{...route,startPcbPortId:undefined}],node)).toBe(false)
  expect(validate([{...route,startPcbPortId:route.endPcbPortId,endPcbPortId:route.startPcbPortId}],node)).toBe(false)
  expect(validate([{...route,route:[...route.route].reverse(),startPcbPortId:route.endPcbPortId,endPcbPortId:route.startPcbPortId}],node)).toBe(true)
  const colocated={...node,portPoints:[...points,{...points[0]!,pcb_port_id:"same-position-alias"}]}
  expect(validate([{...route,startPcbPortId:"same-position-alias"}],colocated)).toBe(true)
  expect(validate([{...route,route:route.route.map((point,index)=>index===0?{...point,pcb_port_id:"foreign-inline"}:point)}],node)).toBe(false)
  const optional=new Pipeline9InteractionGroupedHighDensitySolver({...params,preserveTerminalPcbPortIds:false})
  const optionalValidate=(optional as unknown as {validateGroup(routes:HighDensityRoute[],node:NodeWithPortPoints):boolean}).validateGroup.bind(optional)
  expect(optionalValidate([{...route,startPcbPortId:undefined,endPcbPortId:undefined}],node)).toBe(true)
  expect(optionalValidate([{...route,startPcbPortId:"foreign"}],node)).toBe(false)
})
