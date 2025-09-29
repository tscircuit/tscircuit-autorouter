import cn153082 from "examples/legacy/assets/cn153082-nodeWithPortPoints.json"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import { HighDensityDebugger } from "lib/testing/HighDensityDebugger"
import { HyperHighDensityDebugger } from "lib/testing/HyperHighDensityDebugger"

export default () => {
  return (
    <HyperHighDensityDebugger
      nodeWithPortPoints={cn153082.nodeWithPortPoints}
    />
  )
}
