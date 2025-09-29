import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import simplifiedPathSolver6 from "examples/legacy/assets/simplifiedpathsolver6.json"
import { MultiSimplifiedPathSolver } from "lib/solvers/SimplifiedPathSolver/MultiSimplifiedPathSolver"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"

export default () => {
  const createSolver = () => {
    return new MultiSimplifiedPathSolver({
      ...(simplifiedPathSolver6[0] as any),
      connMap: new ConnectivityMap(simplifiedPathSolver6[0].connMap.netMap),
    })
  }

  return <GenericSolverDebugger createSolver={createSolver} />
}
