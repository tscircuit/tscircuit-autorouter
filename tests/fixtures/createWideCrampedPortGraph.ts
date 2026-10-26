import type {CapacityMeshNode, CapacityMeshNodeId} from "lib/types"
import type {SegmentPortPoint} from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import {SingleTargetNecessaryCrampedPortPointSolver} from "lib/solvers/NecessaryCrampedPortPointSolver/SingleTargetNecessaryCrampedPortPointSolver"

export class CountingPortMap extends Map<CapacityMeshNodeId, SegmentPortPoint[]> {
  getCalls = 0
  override get(id: CapacityMeshNodeId): SegmentPortPoint[] | undefined {
    this.getCalls++
    return super.get(id)
  }
}

export function createWideCrampedPortGraph(count: number): {
  input: ConstructorParameters<typeof SingleTargetNecessaryCrampedPortPointSolver>[0]
  ports: CountingPortMap
  seed: SegmentPortPoint
  links: SegmentPortPoint[]
  exit: SegmentPortPoint
} {
  const nodes: CapacityMeshNode[] = [
    {capacityMeshNodeId:"source",center:{x:0,y:0},width:0.4,height:0.4,layer:"top",availableZ:[0],_containsObstacle:true,_containsTarget:true,_targetConnectionName:"signal"},
    ...[1.2,3.2,5.2].map((x,index)=>({capacityMeshNodeId:["a","b","c"][index]!,center:{x,y:0},width:2,height:count*0.2,layer:"top",availableZ:[0]})),
  ]
  const seed: SegmentPortPoint = {segmentPortPointId:"seed",x:0.2,y:0,availableZ:[0],nodeIds:["source","a"],edgeId:"source-a",connectionName:null,distToCentermostPortOnZ:0,cramped:false}
  const links: SegmentPortPoint[] = Array.from({length:count},(_,index)=>({segmentPortPointId:`link_${index}`,x:2.2,y:(index-(count-1)/2)*0.2,availableZ:[0],nodeIds:["a","b"],edgeId:"a-b",connectionName:null,distToCentermostPortOnZ:Math.abs(index-(count-1)/2)*0.2,cramped:false}))
  const exit: SegmentPortPoint = {segmentPortPointId:"exit",x:4.2,y:0,availableZ:[0],nodeIds:["b","c"],edgeId:"b-c",connectionName:null,distToCentermostPortOnZ:0,cramped:false}
  const ports = new CountingPortMap([["source",[seed]],["a",[seed,...links]],["b",[...links,exit]],["c",[exit]]])
  return {input:{target:nodes[0]!,mapOfCapacityMeshNodeIdToSegmentPortPoints:ports,mapOfCapacityMeshNodeIdToRef:new Map(nodes.map(node=>[node.capacityMeshNodeId,node])),depthLimit:3,shouldIgnoreCrampedPortPoints:false},ports,seed,links,exit}
}
