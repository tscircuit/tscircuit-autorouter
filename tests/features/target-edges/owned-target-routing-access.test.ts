import {expect,test} from "bun:test"
import {CapacityMeshEdgeSolver2_NodeTreeOptimization} from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver2_NodeTreeOptimization"
import {createOwnedTargetEscapeInput} from "../../fixtures/createOwnedTargetEscapeInput"
test("a target can reach routing space through its own fixed escape and full-layer via", () => {
  const input=createOwnedTargetEscapeInput(),before=JSON.stringify(input)
  const solver=new CapacityMeshEdgeSolver2_NodeTreeOptimization(input)
  solver.solve()
  expect(solver.solved).toBe(true)
  expect(solver.failed).toBe(false)
  expect(solver.edges).toHaveLength(3)
  expect(JSON.stringify(input)).toBe(before)
  expect(solver.visualize()).toMatchGraphicsSvg(import.meta.path)
})
