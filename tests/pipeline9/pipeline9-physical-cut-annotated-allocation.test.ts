import { expect, test } from "bun:test"
import type { SerializedHyperGraph } from "@tscircuit/hypergraph"
import { TinyHyperGraphSolver } from "tiny-hypergraph/lib/index"
import { loadSerializedHyperGraph } from "tiny-hypergraph/lib/compat/loadSerializedHyperGraph"
import { annotatePipeline9PhysicalCuts, createPhysicalCutTracker } from "../../lib/solvers/PortPointPathingSolver/tinyhypergraph/pipeline9PhysicalCutResources"

test("annotation and native Tiny loading retain a binding cut that allocates two distinct nets to different layers", () => {
  const ports:SerializedHyperGraph["ports"]=[
    ...[0,1].flatMap(z=>[-0.025,0.025].map((y,i)=>({portId:`cut-${z}-${i}`,region1Id:"left",region2Id:"right",d:{x:0,y,z}}))),
    ...["a","b"].flatMap((name,i)=>[{portId:`start-${name}`,region1Id:`source-${name}`,region2Id:"left",d:{x:-2,y:i===0?-0.025:0.025,z:0}},{portId:`end-${name}`,region1Id:"right",region2Id:`target-${name}`,d:{x:2,y:i===0?-0.025:0.025,z:0}}]),
  ]
  const regions:SerializedHyperGraph["regions"]=[
    ...["left","right"].map((id,i)=>({regionId:id,pointIds:ports.filter(port=>port.region1Id===id||port.region2Id===id).map(port=>port.portId),d:{center:{x:i===0?-1:1,y:0},width:2,height:0.1,availableZ:[0,1]}})),
    ...["a","b"].flatMap((name,i)=>["source","target"].map(side=>({regionId:`${side}-${name}`,pointIds:[`${side==="source"?"start":"end"}-${name}`],d:{center:{x:side==="source"?-2.5:2.5,y:i===0?-0.025:0.025},width:1,height:0.01,availableZ:[0],_containsTarget:true}}))),
  ]
  const graph:SerializedHyperGraph={regions,ports,connections:["a","b"].map(name=>({connectionId:name,startRegionId:`source-${name}`,endRegionId:`target-${name}`,mutuallyConnectedNetworkId:`net-${name}`}))}
  const tracker=createPhysicalCutTracker()
  const annotated=annotatePipeline9PhysicalCuts(graph,{minTraceWidth:0.15,clearance:0.1},tracker)
  expect(tracker.stats.physicalCutTaggedGroups).toBe(2)
  expect(tracker.stats.physicalCutTaggedPorts).toBe(4)
  const {topology,problem}=loadSerializedHyperGraph(annotated)
  const solver=new TinyHyperGraphSolver(topology,problem,{MAX_ITERATIONS:2000,ACCEPT_BEST_SOLUTION_ON_TIMEOUT:true,RIP_THRESHOLD_RAMP_ATTEMPTS:0})
  solver.solve()
  expect(solver.failed,solver.error??"").toBe(false)
  expect(solver.solved).toBe(true)
  const ownersByLayer=[0,1].map(z=>new Set(topology.portMetadata!.flatMap((metadata,index)=>metadata.__pipeline9PhysicalCut&&topology.portZ[index]===z&&solver.state.portAssignment[index]!>=0?[solver.state.portAssignment[index]]:[])))
  expect(ownersByLayer[0]!.size).toBe(1)
  expect(ownersByLayer[1]!.size).toBe(1)
  expect([...ownersByLayer[0]!][0]).not.toBe([...ownersByLayer[1]!][0])
  expect(tracker.stats.physicalCutOwnerChecks).toBeGreaterThan(0)
  expect(tracker.stats.physicalCutCapacityRejections).toBeGreaterThan(0)
})
