import { FixedTopologyHighDensityIntraNodeSolver } from "lib/solvers/FixedTopologyHighDensityIntraNodeSolver"
import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import input from "./via-high-density02-input.json"

export default () => {
  const createSolver = () => {
    return new FixedTopologyHighDensityIntraNodeSolver({
      nodeWithPortPoints: input.nodeWithPortPoints as any,
      colorMap: input.colorMap,
      traceWidth: input.traceWidth,
    })
  }

  return <GenericSolverDebugger createSolver={createSolver} />
}
