import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import { SingleLayerNodeMergerSolver } from "lib/solvers/SingleLayerNodeMerger/SingleLayerNodeMergerSolver"
import nodemerging1 from "../assets/nodemerging1.json"
import { CapacityMeshNode } from "lib/types"

export default () => (
  <GenericSolverDebugger
    createSolver={() => {
      return new SingleLayerNodeMergerSolver(nodemerging1[0] as any)
    }}
  />
)
