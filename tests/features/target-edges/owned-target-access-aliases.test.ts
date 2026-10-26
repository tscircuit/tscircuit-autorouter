import {expect,test} from "bun:test"
import {CapacityMeshEdgeSolver2_NodeTreeOptimization} from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver2_NodeTreeOptimization"
import {createOwnedTargetEscapeInput} from "../../fixtures/createOwnedTargetEscapeInput"
test("physical target neighbors can establish ownership through explicit contact aliases", () => {
  const input=createOwnedTargetEscapeInput()
  input[0]!._targetConnectionName="pad_net";input[0]!._connectedTo=["shared_contact"]
  input[1]!._targetConnectionName="stub_net";input[1]!._connectedTo=["shared_contact"]
  input[2]!._connectedTo=["stub_net"]
  const solver=new CapacityMeshEdgeSolver2_NodeTreeOptimization(input)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.edges).toHaveLength(3)
})
