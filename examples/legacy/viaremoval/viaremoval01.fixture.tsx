import viaRemoval from "examples/legacy/assets/viaremoval01.json"
import { BaseSolver } from "lib/solvers/BaseSolver"
import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import { UselessViaRemovalSolver } from "lib/solvers/UselessViaRemovalSolver/UselessViaRemovalSolver"

export default () => (
  <GenericSolverDebugger
    createSolver={() => {
      const solver = new UselessViaRemovalSolver({
        unsimplifiedHdRoutes: viaRemoval[0].unsimplifiedHdRoutes,
        obstacles: viaRemoval[0].obstacles as any,
        colorMap: viaRemoval[0].colorMap,
        layerCount: 2,
      })
      solver.step()
      return solver
    }}
  />
)
