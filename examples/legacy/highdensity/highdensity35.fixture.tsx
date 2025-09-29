import cn125220 from "examples/legacy/assets/cn125220-nodeWithPortPoints.json"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import { HyperHighDensityDebugger } from "lib/testing/HyperHighDensityDebugger"
import { generateColorMapFromNodeWithPortPoints } from "lib/utils/generateColorMapFromNodeWithPortPoints"

export const hyperParameters = {
  CELL_SIZE_FACTOR: 2,
  VIA_PENALTY_FACTOR_2: 10,
}

export default () => {
  return (
    <HyperHighDensityDebugger
      nodeWithPortPoints={cn125220.nodeWithPortPoints}
    />
    // <GenericSolverDebugger
    //   createSolver={() =>
    //     new IntraNodeRouteSolver({
    //       nodeWithPortPoints: cn62169.nodeWithPortPoints,
    //       colorMap: generateColorMapFromNodeWithPortPoints(
    //         cn62169.nodeWithPortPoints,
    //       ),
    //       hyperParameters,
    //     })
    //   }
    // />
  )
}
