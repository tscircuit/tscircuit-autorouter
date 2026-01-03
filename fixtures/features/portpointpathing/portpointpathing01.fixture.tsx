import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import { PortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import input from "./portpointpathing01-input.json"

export default () => {
  const createSolver = () => {
    return new PortPointPathingSolver({
      simpleRouteJson: input.simpleRouteJson as any,
      inputNodes: input.inputNodes as any,
      capacityMeshNodes: input.capacityMeshNodes as any,
      colorMap: input.colorMap as any,
      nodeMemoryPfMap: new Map(Object.entries(input.nodeMemoryPfMap ?? {})),
      hyperParameters: input.hyperParameters as any,
    })
  }

  return <GenericSolverDebugger createSolver={createSolver} />
}
