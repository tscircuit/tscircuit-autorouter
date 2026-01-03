import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import { PortPointPathingSolver } from "lib/solvers/PortPointPathingSolver/PortPointPathingSolver"
import input from "./portpointpathing01-input.json"

export default () => {
  const createSolver = () => {
    return new PortPointPathingSolver(input as any)
  }

  return <GenericSolverDebugger createSolver={createSolver} />
}
