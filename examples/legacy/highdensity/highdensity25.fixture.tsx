import cn880 from "examples/legacy/assets/cn880-nodeWithPortPoints.json"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"

export default () => {
  return (
    <GenericSolverDebugger
      createSolver={() =>
        new IntraNodeRouteSolver({
          nodeWithPortPoints: cn880.nodeWithPortPoints,
        })
      }
    />
  )
}
