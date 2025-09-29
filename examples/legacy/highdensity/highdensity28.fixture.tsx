import cn159642 from "examples/legacy/assets/cn159642-nodeWithPortPoints.json"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { SingleHighDensityRouteSolver } from "lib/solvers/HighDensitySolver/SingleHighDensityRouteSolver"
import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import { HyperHighDensityDebugger } from "lib/testing/HyperHighDensityDebugger"

export default () => {
  return (
    <GenericSolverDebugger
      createSolver={() => {
        const solver = new IntraNodeRouteSolver({
          nodeWithPortPoints: cn159642.nodeWithPortPoints,
          hyperParameters: {
            CELL_SIZE_FACTOR: 0.5,
            SHUFFLE_SEED: 1,
            FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR: 2,
            FUTURE_CONNECTION_PROX_VIA_PENALTY_FACTOR: 1,
            FUTURE_CONNECTION_PROXIMITY_VD: 10,
            MISALIGNED_DIST_PENALTY_FACTOR: 5,
          },
        })
        return solver
      }}
    />
    // <HyperHighDensityDebugger
    //   nodeWithPortPoints={cn159642.nodeWithPortPoints}
    // />
  )
}
