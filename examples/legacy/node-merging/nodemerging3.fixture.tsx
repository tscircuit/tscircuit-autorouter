import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import { SingleLayerNodeMergerSolver } from "lib/solvers/SingleLayerNodeMerger/SingleLayerNodeMergerSolver"
import nodemerging3 from "../assets/nodemerging3.json"
import { CapacityMeshNode } from "lib/types"

export default () => (
  <GenericSolverDebugger
    createSolver={() => {
      return new SingleLayerNodeMergerSolver(nodemerging3[0] as any)
    }}
  />
)
