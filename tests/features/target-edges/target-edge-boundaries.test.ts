import { expect, test } from "bun:test"
import type { CapacityMeshNode } from "lib/types"
import { CapacityMeshEdgeSolver } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver"
test("target completion retains overlap tolerance, layers, seeded edges and original pair order", () => {
  const scenarios=[
    {x:0.5,z:[0],expected:1},
    {x:1.0005,z:[0],expected:1},
    {x:1.002,z:[0],expected:0},
    {x:0.5,z:[1],expected:0},
    {x:0.5,z:[1,0],expected:1},
  ]
  for(const scenario of scenarios) {
    const nodes:CapacityMeshNode[]=[
      {capacityMeshNodeId:"a",center:{x:0,y:0},width:1,height:1,layer:"top",availableZ:[0],_containsTarget:true},
      {capacityMeshNodeId:"b",center:{x:scenario.x,y:0},width:1,height:1,layer:"top",availableZ:scenario.z,_containsTarget:true},
    ]
    const solver=new CapacityMeshEdgeSolver(nodes)
    solver.handleTargetNodes()
    expect(solver.edges).toHaveLength(scenario.expected)
    if(scenario.expected) {
      expect(solver.edges[0]).toEqual({capacityMeshEdgeId:"ce0",nodeIds:["a","b"]})
      solver.handleTargetNodes()
      expect(solver.edges).toHaveLength(1)
    }
  }
  const nodes:CapacityMeshNode[]=Array.from({length:3},(_,i)=>({capacityMeshNodeId:`node_${i}`,center:{x:i*0.2,y:0},width:1,height:1,layer:"top",availableZ:[0],_containsTarget:true}))
  const solver=new CapacityMeshEdgeSolver(nodes)
  solver.handleTargetNodes()
  expect(solver.edges.map(edge=>edge.nodeIds)).toEqual([["node_0","node_1"],["node_0","node_2"],["node_1","node_2"]])
})
