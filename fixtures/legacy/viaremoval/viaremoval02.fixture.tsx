import viaRemoval from "fixtures/legacy/assets/viaremoval02.json" with {
  type: "json",
}
import { BaseSolver } from "lib/solvers/BaseSolver"
import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import { UselessViaRemovalSolver } from "lib/solvers/UselessViaRemovalSolver/UselessViaRemovalSolver"
import { SingleRouteUselessViaRemovalSolver } from "lib/solvers/UselessViaRemovalSolver/SingleRouteUselessViaRemovalSolver"
import { HighDensityRouteSpatialIndex } from "lib/data-structures/HighDensityRouteSpatialIndex"
import { ObstacleSpatialHashIndex } from "lib/data-structures/ObstacleTree"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"

export default () => (
  <GenericSolverDebugger
    createSolver={() => {
      const solver = new SingleRouteUselessViaRemovalSolver({
        hdRouteSHI: new HighDensityRouteSpatialIndex([]),
        obstacleSHI: new ObstacleSpatialHashIndex(
          viaRemoval.obstacleSHI.obstacles as any,
        ),
        unsimplifiedRoute: viaRemoval.unsimplifiedRoute,
        connMap: new ConnectivityMap({}),
      })
      return solver
    }}
  />
)
