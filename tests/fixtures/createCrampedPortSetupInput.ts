import type {MultiTargetNecessaryCrampedPortPointSolverInput} from "lib/solvers/NecessaryCrampedPortPointSolver/MultiTargetNecessaryCrampedPortPointSolver"
import {createWideCrampedPortGraph} from "./createWideCrampedPortGraph"

export function createCrampedPortSetupInput(count: number): {
  input: MultiTargetNecessaryCrampedPortPointSolverInput
  readonly nodeIdReads: number
  portCount: number
} {
  const wide=createWideCrampedPortGraph(count)
  let nodeIdReads=0
  for(const port of [wide.seed,...wide.links,wide.exit]) {
    const ids=port.nodeIds
    Object.defineProperty(port,"nodeIds",{enumerable:true,get(){nodeIdReads++;return ids}})
  }
  const sharedEdgeSegments=[
    {edgeId:"source-a",nodeIds:["source","a"] as [string,string],start:{x:0.2,y:-0.2},end:{x:0.2,y:0.2},availableZ:[0],portPoints:[wide.seed]},
    {edgeId:"a-b",nodeIds:["a","b"] as [string,string],start:{x:2.2,y:-count*0.1},end:{x:2.2,y:count*0.1},availableZ:[0],portPoints:wide.links},
    {edgeId:"b-c",nodeIds:["b","c"] as [string,string],start:{x:4.2,y:-count*0.1},end:{x:4.2,y:count*0.1},availableZ:[0],portPoints:[wide.exit]},
  ]
  return {input:{sharedEdgeSegments,capacityMeshNodes:[...wide.input.mapOfCapacityMeshNodeIdToRef.values()],simpleRouteJson:{layerCount:2,minTraceWidth:0.1,bounds:{minX:-1,maxX:7,minY:-count*0.1-1,maxY:count*0.1+1},obstacles:[],connections:[{name:"signal",pointsToConnect:[{x:0,y:0,layer:"top"},{x:5.2,y:0,layer:"top"}]}]}},get nodeIdReads(){return nodeIdReads},portCount:count+2}
}
