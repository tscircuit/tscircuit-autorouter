import type { CapacityMeshNode } from "lib/types"
/** Independent target/free pairs in board-world mm (+X right, +Y up). */
export function createTargetEdgeGridInput(count: number): CapacityMeshNode[] {
  const columns = Math.ceil(Math.sqrt(count))
  return Array.from({length:count},(_,i) => {
    const center={x:(i%columns)*2,y:Math.floor(i/columns)*2}
    return [
      {capacityMeshNodeId:`target_${i}`,center,width:0.4,height:0.4,layer:"top",availableZ:[0,1,2,3],_containsTarget:true,_containsObstacle:true,_targetConnectionName:`signal_${i}`},
      {capacityMeshNodeId:`free_${i}`,center:{x:center.x+0.4,y:center.y},width:0.4,height:0.4,layer:"top",availableZ:[0,1,2,3]},
    ]
  }).flat()
}
