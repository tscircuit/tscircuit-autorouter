import viaRemoval from "fixtures/legacy/assets/viaremoval01.json" with {
  type: "json",
}
import { BaseSolver } from "lib/solvers/BaseSolver"
import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import { UselessViaRemovalSolver } from "lib/solvers/UselessViaRemovalSolver/UselessViaRemovalSolver"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"

export default () => (
  <GenericSolverDebugger
    createSolver={() => {
      const solver = new UselessViaRemovalSolver({
        unsimplifiedHdRoutes: viaRemoval[0].unsimplifiedHdRoutes,
        obstacles: viaRemoval[0].obstacles as any,
        colorMap: viaRemoval[0].colorMap,
        layerCount: 2,
        connMap: new ConnectivityMap({}),
      })
      solver.step()
      return solver
    }}
  />
)
