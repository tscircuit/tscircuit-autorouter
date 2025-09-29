import { useMemo } from "react"
import { GenericSolverDebugger } from "lib/testing/GenericSolverDebugger"
import inputData from "examples/legacy/assets/simplifiedpathsolver1.json"
import { SingleSimplifiedPathSolver5 } from "lib/solvers/SimplifiedPathSolver/SingleSimplifiedPathSolver5_Deg45"
import { ConnectivityMap } from "circuit-json-to-connectivity-map"
import simplifiedPathSolver8 from "examples/legacy/assets/simplifiedpathsolver8.json"

export default () => {
  const createSolver = () => {
    return new SingleSimplifiedPathSolver5({
      ...(simplifiedPathSolver8 as any),
      connMap: new ConnectivityMap(simplifiedPathSolver8.connMap),
    })
  }

  return <GenericSolverDebugger createSolver={createSolver} />
}
