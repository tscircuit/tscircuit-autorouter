import type { TopologyMergingSolverParams } from "lib/solvers/TopologyMergingSolver/TopologyMergingSolver"
/** Generated pad/via regions in board-world mm (+X right, +Y up). */
export function createPartiallyCoveredTargetTopology(): TopologyMergingSolverParams {
  return {layerCount:4,nodeGroups:[
    {groupId:"global",isComponent:false,nodes:[{capacityMeshNodeId:"via",center:{x:-0.4,y:0},width:0.5,height:0.5,layer:"top",availableZ:[0,1,2,3],_containsObstacle:true,_containsTarget:true,_connectedTo:["power"]}]},
    {groupId:"component",isComponent:true,nodes:[{capacityMeshNodeId:"pad",center:{x:0,y:0.4},width:0.4,height:0.4,layer:"top",availableZ:[0],_containsObstacle:true,_containsTarget:true,_targetConnectionName:"power"}]},
  ]}
}
