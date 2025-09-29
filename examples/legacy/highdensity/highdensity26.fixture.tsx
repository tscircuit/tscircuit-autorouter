import cn19735 from "examples/legacy/assets/cn19735-nodeWithPortPoints.json"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"

export default () => {
  return (
    <GenericSolverDebugger
      createSolver={() =>
        new IntraNodeRouteSolver({
          nodeWithPortPoints: cn19735.nodeWithPortPoints,
          hyperParameters: {},
        })
      }
    />
  )
}
