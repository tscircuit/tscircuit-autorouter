import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { annotatePipeline9PhysicalCuts, createPhysicalCutTracker } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/pipeline9PhysicalCutResources"

test("nonbinding width inequalities disappear at K>=slots and become active again after slot duplication", () => {
  for(let capacity=1;capacity<=4;capacity++)for(let slots=1;slots<=6;slots++){
    const length=(capacity-1)*0.25+0.01
    const graph:SerializedHyperGraph={regions:["left","right"].map((id,i)=>({regionId:id,pointIds:[],d:{center:{x:i===0?-1:1,y:0},width:2,height:length,availableZ:[0]}})),ports:Array.from({length:slots},(_,i)=>({portId:`slot-${i}`,region1Id:"left",region2Id:"right",d:{x:0,y:slots===1?0:length*0.9*(i/(slots-1)-0.5),z:0}})),connections:[]}
    const tracker=createPhysicalCutTracker()
    const output=annotatePipeline9PhysicalCuts(graph,{minTraceWidth:0.15,clearance:0.1},tracker)
    expect(output.ports.map(port=>[port.portId,port.d.x,port.d.y,port.d.z])).toEqual(graph.ports.map(port=>[port.portId,port.d.x,port.d.y,port.d.z]))
    expect(output.ports.every(port=>Boolean(port.d.__pipeline9PhysicalCut)===(capacity<slots))).toBe(true)
    expect(tracker.stats.physicalCutNonBindingGroups).toBe(Number(capacity>=slots))
    expect(tracker.stats.physicalCutNonBindingPorts).toBe(capacity>=slots?slots:0)
    expect(tracker.stats.physicalCutTaggedGroups).toBe(Number(capacity<slots))
  }
  const graph:SerializedHyperGraph={regions:["left","right"].map((id,i)=>({regionId:id,pointIds:[],d:{center:{x:i===0?-1:1,y:0},width:2,height:0.26,availableZ:[0]}})),ports:[-0.05,0.05].map((y,i)=>({portId:`p${i}`,region1Id:"left",region2Id:"right",d:{x:0,y,z:0}})),connections:[]}
  const tracker=createPhysicalCutTracker()
  const before=annotatePipeline9PhysicalCuts(graph,{minTraceWidth:0.15,clearance:0.1},tracker)
  expect(before.ports.every(port=>!port.d.__pipeline9PhysicalCut)).toBe(true)
  const after=annotatePipeline9PhysicalCuts({...before,ports:[...before.ports,{...before.ports[0]!,portId:"duplicate",d:{...before.ports[0]!.d,y:0}}]},{minTraceWidth:0.15,clearance:0.1},tracker)
  expect(after.ports.every(port=>port.d.__pipeline9PhysicalCut?.capacity===2)).toBe(true)
  // Re-annotation also removes a formerly binding descriptor after contraction.
  const contracted=annotatePipeline9PhysicalCuts({...after,ports:after.ports.slice(0,2)},{minTraceWidth:0.15,clearance:0.1},tracker)
  expect(contracted.ports.every(port=>!port.d.__pipeline9PhysicalCut)).toBe(true)
  expect(graph.ports.every(port=>!port.d.__pipeline9PhysicalCut)).toBe(true)
})
