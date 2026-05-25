import { createPortPointPairsFromPortPoints } from "lib/utils/getPortPointsFromNodeWithPortPoints"
import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import { GrowShrinkHighDensityIntraNodeSolver } from "lib/solvers/HyperHighDensitySolver/GrowShrinkHighDensityIntraNodeSolver"
import type { NodeWithPortPoints } from "lib/types/high-density-types"
const nodeWithPortPoints: NodeWithPortPoints = {
  capacityMeshNodeId: "impossible_single_layer_crossing",
  center: { x: 0, y: 0 },
  width: 2,
  height: 2,
  availableZ: [0],
  portPointsInPairs: createPortPointPairsFromPortPoints([
    {
      connectionName: "net_a",
      rootConnectionName: "net_a",
      x: -1,
      y: 0,
      z: 0,
    },
    {
      connectionName: "net_a",
      rootConnectionName: "net_a",
      x: 1,
      y: 0,
      z: 0,
    },
    {
      connectionName: "net_b",
      rootConnectionName: "net_b",
      x: 0,
      y: -1,
      z: 0,
    },
    {
      connectionName: "net_b",
      rootConnectionName: "net_b",
      x: 0,
      y: 1,
      z: 0,
    },
  ]),
}
export default () => {
  const createSolver = () =>
    new GrowShrinkHighDensityIntraNodeSolver({
      nodeWithPortPoints,
    })
  return (
    <div>
      <div className="m-2 rounded border border-amber-300 bg-amber-50 p-2 text-sm">
        This single-layer node has two same-layer connections whose endpoints
        interleave, so growth cannot make it routable. The grow/shrink solver
        returns a minimal invalid geometry immediately.
      </div>
      <GenericSolverDebugger createSolver={createSolver} />
    </div>
  )
}
