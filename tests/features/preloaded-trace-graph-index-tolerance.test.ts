import {expect,test} from "bun:test"
import {PreloadedTraceGraphSolver} from "lib/autorouter-pipelines/AutoroutingPipeline9_PreloadedTraceGraph/PreloadedTraceGraphSolver"
import type {SharedEdgeSegment} from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type {SimpleRouteJson} from "lib/types"
test("preload boundary index retains near contacts and full-stack via layers",()=>{
  const boundaries: SharedEdgeSegment[]=[
    {edgeId:"via-boundary",nodeIds:["left","right"],start:{x:0,y:-1},end:{x:0,y:1},availableZ:[0,1,2,3],portPoints:[0,1,2,3].map(z=>({segmentPortPointId:"via-port-"+z,x:0,y:0,availableZ:[z],nodeIds:["left","right"],edgeId:"via-boundary",connectionName:null,distToCentermostPortOnZ:0,cramped:false}))},
    ...[0.5e-6,2e-6].map((gap,i)=>({edgeId:"near-boundary-"+i,nodeIds:["left","right"],start:{x:1+gap,y:-1},end:{x:1+gap,y:1},availableZ:[3],portPoints:[{segmentPortPointId:"near-port-"+i,x:1+gap,y:0,availableZ:[3],nodeIds:["left","right"],edgeId:"near-boundary-"+i,connectionName:null,distToCentermostPortOnZ:0,cramped:false}]})),
    {edgeId:"point-boundary",nodeIds:["left","right"],start:{x:0,y:0},end:{x:0,y:0},availableZ:[1],portPoints:[{segmentPortPointId:"point-port",x:0,y:0,availableZ:[1],nodeIds:["left","right"],edgeId:"point-boundary",connectionName:null,distToCentermostPortOnZ:0,cramped:false}]}
  ]
  const srj:SimpleRouteJson={layerCount:4,minTraceWidth:.1,bounds:{minX:-2,maxX:2,minY:-2,maxY:2},obstacles:[],connections:[{name:"RESET",pointsToConnect:[{x:-1,y:0,layer:"top"},{x:1,y:0,layer:"bottom"}]}],traces:[{type:"pcb_trace",pcb_trace_id:"reset-fanout",connection_name:"RESET",route:[{route_type:"wire",x:-1,y:0,layer:"top",width:.1},{route_type:"wire",x:0,y:0,layer:"top",width:.1},{route_type:"via",x:0,y:0,from_layer:"top",to_layer:"bottom",via_diameter:.5,via_hole_diameter:.3},{route_type:"wire",x:0,y:0,layer:"bottom",width:.1},{route_type:"wire",x:1,y:0,layer:"bottom",width:.1}]}]}
  const solver=new PreloadedTraceGraphSolver(boundaries,srj);solver.solve()
  expect(boundaries[0]!.portPoints.map(port=>port._preloadedTracePortAssignments!.some(assignment=>assignment.z===port.availableZ[0]))).toEqual([true,true,true,true])
  expect(boundaries[1]!.portPoints[0]!._preloadedTracePortAssignments?.[0]?.tracePoint).toEqual({x:1,y:0})
  expect(boundaries[2]!.portPoints[0]!._preloadedTracePortAssignments).toBeUndefined()
  expect(boundaries[3]!.portPoints[0]!._preloadedTracePortAssignments?.[0]?.z).toBe(1)
})
