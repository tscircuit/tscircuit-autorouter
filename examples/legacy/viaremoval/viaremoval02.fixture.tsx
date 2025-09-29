import viaRemoval from "examples/legacy/assets/viaremoval02.json"
import { BaseSolver } from "lib/solvers/BaseSolver"
import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import { UselessViaRemovalSolver } from "lib/solvers/UselessViaRemovalSolver/UselessViaRemovalSolver"
import { SingleRouteUselessViaRemovalSolver } from "lib/solvers/UselessViaRemovalSolver/SingleRouteUselessViaRemovalSolver"
import { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex"
import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"

export default () => (
  <GenericSolverDebugger
    createSolver={() => {
      const solver = new SingleRouteUselessViaRemovalSolver({
        hdRouteSHI: new HighDensityRouteSpatialIndex([]),
        obstacleSHI: new ObstacleSpatialHashIndex(
          viaRemoval.obstacleSHI.obstacles as any,
        ),
        unsimplifiedRoute: viaRemoval.unsimplifiedRoute,
      })
      return solver
    }}
  />
)
