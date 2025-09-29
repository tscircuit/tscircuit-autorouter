import cn38186 from "examples/legacy/assets/cn38186-nodeWithPortPoints.json"
import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { generateColorMapFromNodeWithPortPoints } from "lib/utils/generateColorMapFromNodeWithPortPoints"

export default () => {
  return (
    <GenericSolverDebugger
      createSolver={() =>
        new IntraNodeRouteSolver({
          nodeWithPortPoints: cn38186.nodeWithPortPoints,
          colorMap: generateColorMapFromNodeWithPortPoints(
            cn38186.nodeWithPortPoints,
          ),
          hyperParameters: {
            CELL_SIZE_FACTOR: 1,
            SHUFFLE_SEED: 0,
            FUTURE_CONNECTION_PROX_TRACE_PENALTY_FACTOR: 2,
            FUTURE_CONNECTION_PROX_VIA_PENALTY_FACTOR: 1,
            FUTURE_CONNECTION_PROXIMITY_VD: 10,
            MISALIGNED_DIST_PENALTY_FACTOR: 5,
          },
        })
      }
    />
  )
}
