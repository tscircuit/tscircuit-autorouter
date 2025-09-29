import { InteractiveGraphics } from "graphics-debug/react"
import { CapacityMeshNodeSolver } from "lib/solvers/CapacityMeshSolver/CapacityMeshNodeSolver1"
import { SimpleRouteJson } from "lib/types/srj-types"
import meshunderobstacle1 from "../assets/meshunderobstacle1.json"

export default () => {
  const meshSolver = new CapacityMeshNodeSolver(
    meshunderobstacle1 as SimpleRouteJson,
    {
      capacityDepth: 7,
    },
  )
  meshSolver.solve()
  return <InteractiveGraphics graphics={meshSolver.visualize()} />
}
