import type {CapacityMeshNode,CapacityMeshEdge} from "lib/types"

export function createPortLookupInput(count: number): {nodes:CapacityMeshNode[];edges:CapacityMeshEdge[];traceWidth:number;shouldReturnCrampedPortPoints:boolean} {
  const nodes:CapacityMeshNode[]=[],edges:CapacityMeshEdge[]=[]
  for(let i=0;i<count;i++) {
    const left=`left-${i}`,right=`right-${i}`
    nodes.push({capacityMeshNodeId:left,center:{x:0,y:i*2},width:1,height:1,layer:"all",availableZ:[0,1,2,3]},{capacityMeshNodeId:right,center:{x:1,y:i*2},width:1,height:1,layer:"all",availableZ:[0,1,2,3]})
    edges.push({capacityMeshEdgeId:`edge-${i}`,nodeIds:[left,right]})
  }
  return {nodes,edges,traceWidth:0.1,shouldReturnCrampedPortPoints:true}
}
