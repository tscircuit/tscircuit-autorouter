import type { NodeWithPortPoints } from "lib/types/high-density-types"
import { SingleTransitionCrossingRouteSolver } from "lib/solvers/HighDensitySolver/TwoRouteHighDensitySolver/SingleTransitionCrossingRouteSolver"
import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import cn90168 from "examples/legacy/assets/cn90168-nodeWithPortPoints.json"

export default () => {
  return (
    <GenericSolverDebugger
      createSolver={() => {
        const solver = new SingleTransitionCrossingRouteSolver({
          nodeWithPortPoints: cn90168.nodeWithPortPoints,
          viaDiameter: 0.6,
          traceThickness: 0.15,
          obstacleMargin: 0.1,
        })
        return solver
      }}
    />
  )
}
