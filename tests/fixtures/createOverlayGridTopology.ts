import type {TopologyMergingSolverParams} from "lib/solvers/TopologyMergingSolver/TopologyMergingSolver"

export function createOverlayGridTopology(count:number):TopologyMergingSolverParams {
  const columns=Array.from({length:count},(_,i)=>({capacityMeshNodeId:`column-${i}`,center:{x:i+0.5,y:count/2},width:1,height:count,availableZ:[0,1,2,3],layer:"top"}))
  const rows=Array.from({length:count},(_,i)=>({capacityMeshNodeId:`row-${i}`,center:{x:count/2,y:i+0.5},width:count,height:1,availableZ:[0,1,2,3],layer:"top"}))
  return {layerCount:4,nodeGroups:[{groupId:"columns",isComponent:false,nodes:columns},{groupId:"rows",isComponent:false,nodes:rows}]}
}
