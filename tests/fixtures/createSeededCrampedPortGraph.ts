import type {CapacityMeshNode, CapacityMeshNodeId} from "lib/types"
import type {SegmentPortPoint} from "lib/solvers/AvailableSegmentPointSolver/AvailableSegmentPointSolver"
import type {SingleTargetNecessaryCrampedPortPointSolver} from "lib/solvers/NecessaryCrampedPortPointSolver/SingleTargetNecessaryCrampedPortPointSolver"

export function createSeededCrampedPortGraph(seed: number, depthLimit: number, shouldIgnoreCrampedPortPoints: boolean): ConstructorParameters<typeof SingleTargetNecessaryCrampedPortPointSolver>[0] {
  let state=seed
  const random=():number=>{state=(state*1664525+1013904223)>>>0;return state/4294967296}
  const nodes:CapacityMeshNode[]=Array.from({length:9},(_,index)=>({capacityMeshNodeId:`node_${index}`,center:{x:(index%3)*2,y:Math.floor(index/3)*2},width:2,height:2,layer:"top",availableZ:[0],_containsObstacle:index===0}))
  const ports=new Map<CapacityMeshNodeId,SegmentPortPoint[]>(nodes.map(node=>[node.capacityMeshNodeId,[]]))
  for(let index=0;index<9;index++)for(const next of [index%3<2?index+1:-1,index<6?index+3:-1]) {
    if(next<0)continue
    const a=nodes[index]!,b=nodes[next]!,count=2+Math.floor(random()*5)
    for(let offset=0;offset<count;offset++) {
      const along=(offset+0.5)*2/count-1,horizontal=next===index+1
      const port:SegmentPortPoint={segmentPortPointId:`port_${index}_${next}_${offset}`,x:horizontal?a.center.x+1:a.center.x+along,y:horizontal?a.center.y+along:a.center.y+1,availableZ:[0],nodeIds:[a.capacityMeshNodeId,b.capacityMeshNodeId],edgeId:`edge_${index}_${next}`,connectionName:null,distToCentermostPortOnZ:Math.abs(along),cramped:random()<0.3}
      ports.get(a.capacityMeshNodeId)!.push(port);ports.get(b.capacityMeshNodeId)!.push(port)
    }
  }
  return {target:nodes[0]!,depthLimit,shouldIgnoreCrampedPortPoints,mapOfCapacityMeshNodeIdToRef:new Map(nodes.map(node=>[node.capacityMeshNodeId,node])),mapOfCapacityMeshNodeIdToSegmentPortPoints:ports}
}
