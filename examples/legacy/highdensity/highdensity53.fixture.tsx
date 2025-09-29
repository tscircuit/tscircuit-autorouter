import cn310 from "examples/legacy/assets/cn310-nodeWithPortPoints.json"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import { HyperHighDensityDebugger } from "lib/testing/HyperHighDensityDebugger"
import { generateColorMapFromNodeWithPortPoints } from "lib/utils/generateColorMapFromNodeWithPortPoints"
import { MultiHeadPolyLineIntraNodeSolver3 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver3_ViaPossibilitiesSolverIntegration"

export const hyperParameters = {
  SEGMENTS_PER_POLYLINE: 6,
}

export default () => {
  return (
    <HyperHighDensityDebugger nodeWithPortPoints={cn310.nodeWithPortPoints} />
    // <GenericSolverDebugger
    //   createSolver={() =>
    //     new MultiHeadPolyLineIntraNodeSolver3({
    //       nodeWithPortPoints: cn310.nodeWithPortPoints,
    //       hyperParameters,
    //     })
    //   }
    // />
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
