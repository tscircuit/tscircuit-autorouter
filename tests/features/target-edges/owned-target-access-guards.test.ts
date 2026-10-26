import {expect,test} from "bun:test"
import {CapacityMeshEdgeSolver2_NodeTreeOptimization} from "lib/solvers/CapacityMeshSolver/CapacityMeshEdgeSolver2_NodeTreeOptimization"
import {createOwnedTargetEscapeInput} from "../../fixtures/createOwnedTargetEscapeInput"
test("owned-target access rejects foreign, unowned, disconnected, wrong-layer and sealed paths", () => {
  for(const scenario of ["foreign","unowned","disconnected","wrong_layer","sealed"] as const) {
    const input=createOwnedTargetEscapeInput()
    if(scenario==="foreign") {input[1]!._targetConnectionName="foreign";input[2]!._connectedTo=["foreign"]}
    if(scenario==="unowned") input[1]!._targetConnectionName=undefined
    if(scenario==="disconnected") input[1]!.center.x=4
    if(scenario==="wrong_layer") input[2]!.availableZ=[3]
    if(scenario==="sealed") input.pop()
    const solver=new CapacityMeshEdgeSolver2_NodeTreeOptimization(input)
    expect(()=>solver.solve(),scenario).toThrow('Target obstacle region "pad" for connection "supply" has no bordering routing edge')
    expect(solver.solved,scenario).toBe(false)
  }
})
