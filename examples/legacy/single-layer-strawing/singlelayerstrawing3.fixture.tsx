import { InteractiveGraphics } from "graphics-debug/react"
import { CapacityMeshNodeSolver } from "lib/solvers/CapacityMeshSolver/CapacityMeshNodeSolver1"
import { SimpleRouteJson } from "lib/types/srj-types"
import meshunderobstacle1 from "../assets/meshunderobstacle1.json"
import { SingleLayerNodeMergerSolver } from "lib/solvers/SingleLayerNodeMerger/SingleLayerNodeMergerSolver"
import { combineVisualizations } from "lib/utils/combineVisualizations"
import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import { StrawSolver } from "lib/solvers/StrawSolver/StrawSolver"
import singlelayerstrawing3 from "../assets/singlelayerstrawing3.json"
import { CapacityMeshNode } from "lib/types"

export default () => {
  return (
    <GenericSolverDebugger
      createSolver={() => {
        const sameLayerNodeMerger = new SingleLayerNodeMergerSolver(
          singlelayerstrawing3[0] as any,
        )
        return sameLayerNodeMerger
      }}
    />
  )
}
