import { useMemo } from "react"
import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import { SingleSimplifiedPathSolver5 } from "lib/solvers/SimplifiedPathSolver/SingleSimplifiedPathSolver5_Deg45"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import simplifiedPathSolver9 from "examples/legacy/assets/simplifiedpathsolver9.json"

export default () => {
  const createSolver = () => {
    return new SingleSimplifiedPathSolver5({
      ...(simplifiedPathSolver9[0] as any),
      connMap: new ConnectivityMap(simplifiedPathSolver9[0].connMap.netMap),
    })
  }

  return <GenericSolverDebugger createSolver={createSolver} />
}
