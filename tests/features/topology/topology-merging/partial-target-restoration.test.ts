import { createRectFromCapacityNode } from "lib/utils/createRectFromCapacityNode"
import { expect, test } from "bun:test"
import { TopologyMergingSolver } from "lib/solvers/TopologyMergingSolver/TopologyMergingSolver"
import { createPartiallyCoveredTargetTopology } from "../../../fixtures/createPartiallyCoveredTargetTopology"
test("a partly masked component target is not restored over an authoritative global via", () => {
  const input=createPartiallyCoveredTargetTopology()
  const original=JSON.stringify(input)
  const solver=new TopologyMergingSolver(input)
  expect({title:"Authoritative via partially covers a component pad", rects: input.nodeGroups.flatMap(group=>group.nodes.map(node=>createRectFromCapacityNode(node)))}).toMatchGraphicsSvg(import.meta.path)
  solver.solve()
  expect(solver.failed).toBe(false)
  expect(solver.solved).toBe(true)
  const output=solver.getOutput()
  expect(output.find(n=>n.capacityMeshNodeId==="via")).toMatchObject(input.nodeGroups[0]!.nodes[0]!)
  const padRegions=output.filter(n=>n._targetConnectionName==="power")
  expect(padRegions.reduce((sum,n)=>sum+n.width*n.height,0)).toBeCloseTo(0.1575,8)
  expect(padRegions.every(n=>n.availableZ.length===1&&n.availableZ[0]===0)).toBe(true)
  expect(JSON.stringify(input)).toBe(original)
})
