import { expect, spyOn, test } from "bun:test"
import { CapacityMeshEdgeSolver } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver"
import { CapacityMeshEdgeSolver2_NodeTreeOptimization } from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver2_NodeTreeOptimization"
import { createTargetEdgeGridInput } from "../../fixtures/createTargetEdgeGridInput"
test("independent target routing edges do not scan every target pair", () => {
  const count=256, input=createTargetEdgeGridInput(count), original=JSON.stringify(input)
  const checks=spyOn(CapacityMeshEdgeSolver.prototype,"doNodesTouchOrOverlap")
  try {
    const solver=new CapacityMeshEdgeSolver2_NodeTreeOptimization(input)
    solver.solve()
    expect(solver.solved).toBe(true)
    expect(solver.failed).toBe(false)
    expect(solver.edges).toHaveLength(count)
    expect(solver.edges.every((edge,i)=>edge.capacityMeshEdgeId===`ce${i}`&&edge.nodeIds[0]===`target_${i}`&&edge.nodeIds[1]===`free_${i}`)).toBe(true)
    expect(JSON.stringify(input)).toBe(original)
    const visual=new CapacityMeshEdgeSolver2_NodeTreeOptimization(createTargetEdgeGridInput(8))
    visual.solve()
    expect(visual.solved).toBe(true)
    expect(visual.visualize()).toMatchGraphicsSvg(import.meta.path)
    expect(checks.mock.calls.length).toBeLessThanOrEqual(count*20)
  } finally {checks.mockRestore()}
})
