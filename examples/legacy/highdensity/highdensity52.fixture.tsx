import cn23108 from "examples/legacy/assets/cn23108-nodeWithPortPoints.json"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import { HyperHighDensityDebugger } from "lib/testing/HyperHighDensityDebugger"
import { generateColorMapFromNodeWithPortPoints } from "lib/utils/generateColorMapFromNodeWithPortPoints"
import { MultiHeadPolyLineIntraNodeSolver3 } from "lib/solvers/HighDensitySolver/MultiHeadPolyLineIntraNodeSolver/MultiHeadPolyLineIntraNodeSolver3_ViaPossibilitiesSolverIntegration"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"

export const hyperParameters = {
  SEGMENTS_PER_POLYLINE: 6,
}

const connMap = new ConnectivityMap({})
connMap.addConnections([["source_net_0_mst19", "source_net_0_mst156"]])

export default () => {
  return (
    <HyperHighDensityDebugger nodeWithPortPoints={cn23108} connMap={connMap} />
    // <GenericSolverDebugger
    //   createSolver={() =>
    //     new MultiHeadPolyLineIntraNodeSolver3({
    //       nodeWithPortPoints: cn22273.nodeWithPortPoints,
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
