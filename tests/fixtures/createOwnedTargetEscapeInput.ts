import type {CapacityMeshNode} from "lib/types"
/** Generated pad, fixed stub, full-layer via and free exit, in board-world mm. */
export function createOwnedTargetEscapeInput(): CapacityMeshNode[] {
  return [
    {capacityMeshNodeId:"pad",center:{x:0,y:0},width:0.4,height:0.4,layer:"top",availableZ:[0],_containsTarget:true,_containsObstacle:true,_targetConnectionName:"supply"},
    {capacityMeshNodeId:"stub",center:{x:0.6,y:0},width:1.2,height:0.1,layer:"top",availableZ:[0],_containsTarget:true,_containsObstacle:true,_targetConnectionName:"supply"},
    {capacityMeshNodeId:"via",center:{x:1,y:0},width:0.5,height:0.5,layer:"top",availableZ:[0,1,2,3],_containsTarget:true,_containsObstacle:true,_connectedTo:["supply"]},
    {capacityMeshNodeId:"free",center:{x:1.5,y:0},width:0.5,height:0.5,layer:"bottom",availableZ:[3]},
  ]
}
