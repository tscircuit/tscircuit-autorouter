import { expect, test } from "bun:test"
import { CapacityMeshEdgeSolver } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver"
import { createTargetEdgeGridInput } from "../../fixtures/createTargetEdgeGridInput"
test("target routing-access validation retains the first missing access error and ignores unrelated edges", () => {
  const nodes=createTargetEdgeGridInput(3)
  const solver=new CapacityMeshEdgeSolver(nodes)
  solver.edges=[{capacityMeshEdgeId:"existing",nodeIds:["target_2","free_2"]}]
  expect(()=>solver.handleTargetNodes()).toThrow('Target obstacle region "target_0" for connection "signal_0" has no bordering routing edge')
  solver.edges.push({capacityMeshEdgeId:"first",nodeIds:["target_0","free_0"]})
  expect(()=>solver.handleTargetNodes()).toThrow('Target obstacle region "target_1" for connection "signal_1" has no bordering routing edge')
  solver.edges.push({capacityMeshEdgeId:"second",nodeIds:["target_1","free_1"]})
  expect(()=>solver.handleTargetNodes()).not.toThrow()
  expect(solver.edges).toHaveLength(3)
})
