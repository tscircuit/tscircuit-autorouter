import { createPortPointPairsFromPortPoints } from "lib/utils/getPortPointsFromNodeWithPortPoints"
import { IntraNodeRouteSolver } from "lib/solvers/HighDensitySolver/IntraNodeSolver"
import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import { generateColorMapFromNodeWithPortPoints } from "lib/utils/generateColorMapFromNodeWithPortPoints"
const hd = {
  nodeId: "cmn_0",
  capacityMeshNode: null,
  nodeWithPortPoints: {
    capacityMeshNodeId: "cmn_0",
    portPointsInPairs: createPortPointPairsFromPortPoints([
      {
        x: 4.49,
        y: -0.3200000000000002,
        z: 0,
        connectionName: "source_trace_0",
      },
      {
        x: -0.51,
        y: -0.3200000000000002,
        z: 0,
        connectionName: "source_trace_0",
      },
    ]),
    center: {
      x: 0,
      y: -5.16,
    },
    width: 20,
    height: 9.68,
  },
}
// export default () => {
//   return <HyperHighDensityDebugger nodeWithPortPoints={hd.nodeWithPortPoints} />
// }
export default () => {
  return (
    <GenericSolverDebugger
      createSolver={() => {
        return new IntraNodeRouteSolver(hd)
      }}
    />
  )
}
